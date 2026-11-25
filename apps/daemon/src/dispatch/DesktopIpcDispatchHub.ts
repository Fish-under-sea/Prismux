import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import {
  isAntigravityProvider,
  isDispatchCallerKind,
  isDispatchReasoningEffort,
  isDispatchTaskCategory,
  type AntigravityGuardDecision,
  type DispatchCallerKind,
  type DispatchCancelResponse,
  type DispatchCompleteRequest,
  type DispatchCompleteResponse,
  type DispatchConfirmResponse,
  type DispatchReplyChannel,
  type DispatchSseEventName,
  type DispatchTaskArtifact,
  type DispatchTaskListResponse,
  type DispatchTaskStatus,
  type DispatchThreadRequest,
  type DispatchThreadResponse,
  type PrismuxDispatchEnvelope
} from "@prismux/protocol";
import {
  AntigravityGuardDeniedError,
  AntigravityPolicyGuard
} from "../security/AntigravityPolicyGuard.js";
import { ArtifactResultBackdoor } from "./ArtifactResultBackdoor.js";
import { TaskDispatchRouter } from "./TaskDispatchRouter.js";

const DISPATCH_TASKS_FILENAME = "dispatch-tasks.json" as const;
const MAX_PERSISTED_TASKS = 200;

export class DispatchHubError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "DispatchHubError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface DispatchHubSseEvent {
  event: DispatchSseEventName;
  data: unknown;
}

export type DispatchHubEventListener = (evt: DispatchHubSseEvent) => void;

export interface DispatchCompletionCallbackPayload {
  envelope: PrismuxDispatchEnvelope;
  artifact: DispatchTaskArtifact;
  directReplyText: string;
}

export type DispatchCompletionListener = (
  payload: DispatchCompletionCallbackPayload
) => Promise<void> | void;

export interface DesktopIpcDispatchHubOptions {
  dataDir?: string;
  router?: TaskDispatchRouter;
  policyGuard?: AntigravityPolicyGuard;
  artifactBackdoor?: ArtifactResultBackdoor;
  headlessExecutor?: (
    envelope: PrismuxDispatchEnvelope
  ) => Promise<void> | void;
  onTaskCompleted?: DispatchCompletionListener;
  now?: () => number;
}

export interface DispatchThreadExecutionResult extends DispatchThreadResponse {
  httpStatus: 200 | 202;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(
    dir,
    `.tmp-${basename(filePath)}-${process.pid}-${randomUUID()}`
  );
  try {
    writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      // Ignore temp cleanup failure
    }
    throw err;
  }
}

function parseReplyChannel(raw: unknown): DispatchReplyChannel | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const kindRaw = raw["kind"];
  if (
    kindRaw !== "desktop" &&
    kindRaw !== "qq" &&
    kindRaw !== "gmail" &&
    kindRaw !== "overnight_factory" &&
    kindRaw !== "webhook"
  ) {
    return undefined;
  }
  return {
    kind: kindRaw,
    ...(typeof raw["targetId"] === "string"
      ? { targetId: raw["targetId"] }
      : {}),
    ...(typeof raw["recipient"] === "string"
      ? { recipient: raw["recipient"] }
      : {}),
    ...(typeof raw["inReplyTo"] === "string"
      ? { inReplyTo: raw["inReplyTo"] }
      : {}),
    ...(typeof raw["threadId"] === "string"
      ? { threadId: raw["threadId"] }
      : {}),
    ...(typeof raw["label"] === "string" ? { label: raw["label"] } : {})
  };
}

/**
 * Central Electron IPC Dispatch Hub (Daemon side):
 * - Routes incoming tasks through `TaskDispatchRouter` (Parameter Backdoor)
 *   and `AntigravityPolicyGuard` (AGY role hard-lock).
 * - Streams `dispatch_thread` / `dispatch_confirmed` / `dispatch_cancelled` / `dispatch_completed`
 *   events to connected Electron SSE subscribers, and queues pending envelopes when no UI
 *   renderer is connected (tray / locked screen / headless mode).
 * - Runs `ArtifactResultBackdoor` on task completion for straight-to-commander / QQ / Gmail replies.
 */
export class DesktopIpcDispatchHub {
  private readonly persistPath: string | undefined;
  private readonly router: TaskDispatchRouter;
  private readonly policyGuard: AntigravityPolicyGuard;
  private readonly artifactBackdoor: ArtifactResultBackdoor;
  private readonly headlessExecutor?: (
    envelope: PrismuxDispatchEnvelope
  ) => Promise<void> | void;
  private readonly now: () => number;

  private readonly tasks = new Map<string, PrismuxDispatchEnvelope>();
  private readonly pendingQueue = new Map<string, PrismuxDispatchEnvelope>();
  private readonly listeners = new Set<DispatchHubEventListener>();
  private readonly completionListeners = new Set<DispatchCompletionListener>();

  constructor(options: DesktopIpcDispatchHubOptions = {}) {
    this.persistPath =
      options.dataDir !== undefined
        ? join(options.dataDir, "data", DISPATCH_TASKS_FILENAME)
        : undefined;
    this.policyGuard = options.policyGuard ?? new AntigravityPolicyGuard();
    this.router = options.router ?? new TaskDispatchRouter();
    this.artifactBackdoor =
      options.artifactBackdoor ??
      new ArtifactResultBackdoor({
        policyGuard: this.policyGuard,
        now: options.now
      });
    this.headlessExecutor = options.headlessExecutor;
    this.now = options.now ?? (() => Date.now());
    if (options.onTaskCompleted !== undefined) {
      this.completionListeners.add(options.onTaskCompleted);
    }
    this.hydrateFromDisk();
  }

  getListenerCount(): number {
    return this.listeners.size;
  }

  getPendingQueueSize(): number {
    return this.pendingQueue.size;
  }

  onTaskCompleted(listener: DispatchCompletionListener): () => void {
    this.completionListeners.add(listener);
    return () => {
      this.completionListeners.delete(listener);
    };
  }

  subscribeEvents(listener: DispatchHubEventListener): () => void {
    const wasEmpty = this.listeners.size === 0;
    this.listeners.add(listener);

    // Flush queued envelopes (including tray/locked-screen/headless queued tasks & awaiting drafts)
    // immediately when a renderer/main-process SSE client connects.
    const toFlush = new Map<string, PrismuxDispatchEnvelope>();
    for (const [taskId, queuedEnvelope] of this.pendingQueue.entries()) {
      toFlush.set(taskId, queuedEnvelope);
    }
    if (wasEmpty) {
      for (const task of this.tasks.values()) {
        if (task.status === "awaiting_human_confirmation") {
          toFlush.set(task.taskId, task);
        }
      }
    }

    if (toFlush.size > 0) {
      let mutated = false;
      for (const [taskId, envelope] of toFlush.entries()) {
        let deliverable = envelope;
        if (deliverable.status === "queued") {
          deliverable = {
            ...deliverable,
            status: "dispatched",
            updatedAt: new Date(this.now()).toISOString()
          };
          this.tasks.set(taskId, deliverable);
          mutated = true;
        }
        this.pendingQueue.delete(taskId);
        try {
          listener({ event: "dispatch_thread", data: deliverable });
        } catch {
          // Listener errors must never destabilize dispatch hub.
        }
      }
      if (mutated) {
        this.persistToDisk();
      }
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispatchThread(
    rawRequest: DispatchThreadRequest | Record<string, unknown>
  ): Promise<DispatchThreadExecutionResult> {
    const request = this.validateDispatchRequest(rawRequest);
    const routed = this.router.route(request);

    const decision: AntigravityGuardDecision =
      this.policyGuard.evaluateDispatch({
        callerKind: request.callerKind,
        targetProvider: routed.provider,
        targetModelId: routed.modelId,
        explicitAntigravityRequested: routed.explicitAntigravityRequested
      });

    if (!decision.allowed) {
      throw new AntigravityGuardDeniedError(
        decision.code ?? "AGY_CONTROLLED_AGENT_LOCKED",
        decision.reason,
        decision
      );
    }

    const nowIso = new Date(this.now()).toISOString();
    const taskId =
      request.taskId && request.taskId.trim().length > 0
        ? request.taskId.trim()
        : `dispatch-${this.now()}-${randomUUID().slice(0, 8)}`;

    const hasListeners = this.listeners.size > 0;
    const initialStatus: DispatchTaskStatus =
      decision.decision === "stage_draft_only"
        ? "awaiting_human_confirmation"
        : hasListeners
          ? "dispatched"
          : "queued";

    const envelope: PrismuxDispatchEnvelope = {
      taskId,
      status: initialStatus,
      mode: decision.mode,
      workspacePath: request.workspacePath,
      ...(request.worktreePath !== undefined
        ? { worktreePath: request.worktreePath }
        : {}),
      ...(request.branchName !== undefined
        ? { branchName: request.branchName }
        : {}),
      prompt: request.prompt,
      provider: routed.provider,
      modelId: routed.modelId,
      reasoningEffort: routed.reasoningEffort,
      callerKind: request.callerKind,
      taskCategory: routed.taskCategory,
      createdAt: nowIso,
      updatedAt: nowIso,
      requiresHumanConfirmation: decision.requiresHumanConfirmation,
      ...(decision.requiresHumanConfirmation
        ? { confirmationReason: decision.reason }
        : {}),
      ...(request.memoryContextSummary !== undefined
        ? { memoryContextSummary: request.memoryContextSummary }
        : {}),
      ...(request.replyChannel !== undefined
        ? { replyChannel: request.replyChannel }
        : {}),
      ...(request.threadId !== undefined ? { threadId: request.threadId } : {})
    };

    this.storeTask(envelope);

    const deliveredToListeners = this.emitEvent("dispatch_thread", envelope);
    const queuedForRenderer = deliveredToListeners === 0;
    if (queuedForRenderer) {
      this.pendingQueue.set(taskId, envelope);
    }

    // Headless fallback for non-AGY auto tasks when no Electron renderer is connected.
    if (
      queuedForRenderer &&
      envelope.mode === "send" &&
      !envelope.requiresHumanConfirmation &&
      !isAntigravityProvider(envelope.provider) &&
      this.headlessExecutor !== undefined
    ) {
      const runningEnvelope: PrismuxDispatchEnvelope = {
        ...envelope,
        status: "running",
        updatedAt: new Date(this.now()).toISOString()
      };
      this.storeTask(runningEnvelope);
      try {
        await this.headlessExecutor(runningEnvelope);
      } catch {
        const failedEnvelope: PrismuxDispatchEnvelope = {
          ...(this.tasks.get(taskId) ?? runningEnvelope),
          status: "failed",
          updatedAt: new Date(this.now()).toISOString()
        };
        this.storeTask(failedEnvelope);
      }
    }

    const latestEnvelope = this.tasks.get(taskId) ?? envelope;
    return {
      ok: true,
      httpStatus: decision.httpStatus === 202 ? 202 : 200,
      decision,
      envelope: latestEnvelope,
      deliveredToListeners,
      queuedForRenderer
    };
  }

  /**
   * Registers an already-prepared Draft-Only envelope (e.g. from interactive Gmail `#factory`
   * staging an isolated Worktree for personal AGY) so it appears in `/v1/dispatch/tasks`
   * and pushes over `/v1/dispatch/events`.
   */
  stageDraftTask(
    input: Omit<
      PrismuxDispatchEnvelope,
      "status" | "mode" | "requiresHumanConfirmation" | "createdAt"
    > & { createdAt?: string }
  ): PrismuxDispatchEnvelope {
    const nowIso = input.createdAt ?? new Date(this.now()).toISOString();
    const envelope: PrismuxDispatchEnvelope = {
      ...input,
      status: "awaiting_human_confirmation",
      mode: "draft_only",
      requiresHumanConfirmation: true,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    this.storeTask(envelope);
    const delivered = this.emitEvent("dispatch_thread", envelope);
    if (delivered === 0) {
      this.pendingQueue.set(envelope.taskId, envelope);
    }
    return envelope;
  }

  async confirmTask(
    taskId: string,
    confirmedBy: unknown
  ): Promise<DispatchConfirmResponse> {
    const actor = this.policyGuard.assertHumanDesktopConfirmation(confirmedBy);
    const existing = this.tasks.get(taskId);
    if (existing === undefined) {
      throw new DispatchHubError(
        404,
        "DISPATCH_TASK_NOT_FOUND",
        `Dispatch task "${taskId}" was not found.`
      );
    }
    if (existing.status !== "awaiting_human_confirmation") {
      throw new DispatchHubError(
        409,
        "DISPATCH_INVALID_STATE",
        `Dispatch task "${taskId}" is in status "${existing.status}" and cannot be confirmed.`
      );
    }

    const nowIso = new Date(this.now()).toISOString();
    const updated: PrismuxDispatchEnvelope = {
      ...existing,
      status: "confirmed_sent",
      mode: "send",
      requiresHumanConfirmation: false,
      confirmedBy: actor,
      confirmedAt: nowIso,
      updatedAt: nowIso
    };

    this.pendingQueue.delete(taskId);
    this.storeTask(updated);
    this.emitEvent("dispatch_confirmed", updated);

    return {
      ok: true,
      taskId,
      envelope: updated
    };
  }

  async cancelTask(
    taskId: string,
    reason?: string
  ): Promise<DispatchCancelResponse> {
    const existing = this.tasks.get(taskId);
    if (existing === undefined) {
      throw new DispatchHubError(
        404,
        "DISPATCH_TASK_NOT_FOUND",
        `Dispatch task "${taskId}" was not found.`
      );
    }
    if (existing.status === "completed") {
      throw new DispatchHubError(
        409,
        "DISPATCH_INVALID_STATE",
        `Dispatch task "${taskId}" is already completed and cannot be cancelled.`
      );
    }

    const nowIso = new Date(this.now()).toISOString();
    const updated: PrismuxDispatchEnvelope = {
      ...existing,
      status: "cancelled",
      requiresHumanConfirmation: false,
      cancelledAt: nowIso,
      updatedAt: nowIso,
      ...(reason && reason.trim().length > 0
        ? { confirmationReason: reason.trim() }
        : {})
    };

    this.pendingQueue.delete(taskId);
    this.storeTask(updated);
    this.emitEvent("dispatch_cancelled", updated);

    return {
      ok: true,
      taskId,
      envelope: updated
    };
  }

  async completeTask(
    taskId: string,
    input: DispatchCompleteRequest = {}
  ): Promise<DispatchCompleteResponse> {
    const existing = this.tasks.get(taskId);
    if (existing === undefined) {
      throw new DispatchHubError(
        404,
        "DISPATCH_TASK_NOT_FOUND",
        `Dispatch task "${taskId}" was not found.`
      );
    }

    // Stop-hook safety guard: NEVER allow post-Stop auto-callback to re-invoke personal AGY without human confirmation.
    if (
      typeof input.callbackTargetProvider === "string" &&
      input.callbackTargetProvider.trim().length > 0
    ) {
      this.artifactBackdoor.assertStopCallbackAllowed(
        input.callbackTargetProvider,
        { humanConfirmed: input.humanConfirmed === true }
      );
    }

    const threadId =
      input.threadId?.trim() || existing.threadId || `thread-${taskId}`;
    const workspacePath =
      input.workspacePath?.trim() ||
      existing.worktreePath ||
      existing.workspacePath;

    const artifact = this.artifactBackdoor.extractArtifact({
      taskId,
      threadId,
      workspacePath,
      finalAssistantText: input.finalAssistantText,
      modifiedFiles: input.modifiedFiles,
      diffStats: input.diffStats,
      provider: existing.provider,
      modelId: existing.modelId,
      branchName: input.branchName ?? existing.branchName,
      commitSha: input.commitSha,
      testPassed: input.testPassed,
      baseRef: input.baseRef,
      skipGitInspection: input.skipGitInspection
    });

    const channelKind =
      existing.replyChannel?.kind === "qq"
        ? "qq"
        : existing.replyChannel?.kind === "gmail" ||
            existing.replyChannel?.kind === "overnight_factory"
          ? "gmail"
          : "desktop";
    const directReplyText = this.artifactBackdoor.formatDirectReply(
      artifact,
      channelKind
    );

    const nowIso = new Date(this.now()).toISOString();
    const updated: PrismuxDispatchEnvelope = {
      ...existing,
      status: "completed",
      requiresHumanConfirmation: false,
      threadId,
      completedAt: nowIso,
      updatedAt: nowIso,
      artifact
    };

    this.pendingQueue.delete(taskId);
    this.storeTask(updated);
    this.emitEvent("dispatch_completed", {
      ...updated,
      artifact,
      directReplyText
    });

    for (const listener of Array.from(this.completionListeners)) {
      await listener({
        envelope: updated,
        artifact,
        directReplyText
      });
    }

    return {
      ok: true,
      taskId,
      envelope: updated,
      artifact,
      directReplyText
    };
  }

  getTask(taskId: string): PrismuxDispatchEnvelope | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(filter?: {
    status?: DispatchTaskStatus;
    callerKind?: DispatchCallerKind;
  }): DispatchTaskListResponse {
    const all = Array.from(this.tasks.values()).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    const awaitingConfirmationCount = all.filter(
      (item) => item.status === "awaiting_human_confirmation"
    ).length;
    const filtered = all.filter((item) => {
      if (filter?.status !== undefined && item.status !== filter.status) {
        return false;
      }
      if (
        filter?.callerKind !== undefined &&
        item.callerKind !== filter.callerKind
      ) {
        return false;
      }
      return true;
    });
    return {
      ok: true,
      tasks: filtered,
      total: filtered.length,
      awaitingConfirmationCount
    };
  }

  private validateDispatchRequest(
    raw: DispatchThreadRequest | Record<string, unknown>
  ): DispatchThreadRequest {
    if (!isPlainObject(raw)) {
      throw new DispatchHubError(
        400,
        "INVALID_DISPATCH_PAYLOAD",
        "Dispatch payload must be a JSON object."
      );
    }
    const prompt =
      typeof raw["prompt"] === "string" ? raw["prompt"].trim() : "";
    if (prompt.length === 0) {
      throw new DispatchHubError(
        400,
        "INVALID_DISPATCH_PAYLOAD",
        'Field "prompt" must be a non-empty string.'
      );
    }
    const workspacePath =
      typeof raw["workspacePath"] === "string"
        ? raw["workspacePath"].trim()
        : "";
    if (workspacePath.length === 0) {
      throw new DispatchHubError(
        400,
        "INVALID_DISPATCH_PAYLOAD",
        'Field "workspacePath" must be a non-empty string.'
      );
    }
    const callerKindRaw = raw["callerKind"];
    if (!isDispatchCallerKind(callerKindRaw)) {
      throw new DispatchHubError(
        400,
        "INVALID_DISPATCH_PAYLOAD",
        `Invalid or missing "callerKind": "${String(callerKindRaw ?? "")}".`
      );
    }

    const taskCategoryRaw = raw["taskCategory"];
    if (
      taskCategoryRaw !== undefined &&
      !isDispatchTaskCategory(taskCategoryRaw)
    ) {
      throw new DispatchHubError(
        400,
        "INVALID_DISPATCH_PAYLOAD",
        `Invalid "taskCategory": "${String(taskCategoryRaw)}".`
      );
    }

    const reasoningRaw = raw["reasoningEffort"];
    if (
      reasoningRaw !== undefined &&
      !isDispatchReasoningEffort(reasoningRaw)
    ) {
      throw new DispatchHubError(
        400,
        "INVALID_DISPATCH_PAYLOAD",
        `Invalid "reasoningEffort": "${String(reasoningRaw)}".`
      );
    }

    const replyChannel = parseReplyChannel(raw["replyChannel"]);

    return {
      ...(typeof raw["taskId"] === "string" && raw["taskId"].trim().length > 0
        ? { taskId: raw["taskId"].trim() }
        : {}),
      prompt,
      workspacePath,
      ...(typeof raw["worktreePath"] === "string" &&
      raw["worktreePath"].trim().length > 0
        ? { worktreePath: raw["worktreePath"].trim() }
        : {}),
      ...(typeof raw["branchName"] === "string" &&
      raw["branchName"].trim().length > 0
        ? { branchName: raw["branchName"].trim() }
        : {}),
      callerKind: callerKindRaw,
      ...(taskCategoryRaw !== undefined
        ? { taskCategory: taskCategoryRaw }
        : {}),
      ...(typeof raw["provider"] === "string" &&
      raw["provider"].trim().length > 0
        ? { provider: raw["provider"].trim() }
        : {}),
      ...(typeof raw["modelId"] === "string" && raw["modelId"].trim().length > 0
        ? { modelId: raw["modelId"].trim() }
        : {}),
      ...(reasoningRaw !== undefined ? { reasoningEffort: reasoningRaw } : {}),
      ...(typeof raw["explicitAntigravityRequested"] === "boolean"
        ? { explicitAntigravityRequested: raw["explicitAntigravityRequested"] }
        : {}),
      ...(typeof raw["memoryContextSummary"] === "string" &&
      raw["memoryContextSummary"].trim().length > 0
        ? { memoryContextSummary: raw["memoryContextSummary"].trim() }
        : {}),
      ...(replyChannel !== undefined ? { replyChannel } : {}),
      ...(typeof raw["threadId"] === "string" &&
      raw["threadId"].trim().length > 0
        ? { threadId: raw["threadId"].trim() }
        : {})
    };
  }

  private emitEvent(event: DispatchSseEventName, data: unknown): number {
    let delivered = 0;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener({ event, data });
        delivered += 1;
      } catch {
        // Ignore individual listener errors.
      }
    }
    return delivered;
  }

  private storeTask(envelope: PrismuxDispatchEnvelope): void {
    this.tasks.set(envelope.taskId, envelope);
    if (this.tasks.size > MAX_PERSISTED_TASKS) {
      const sorted = Array.from(this.tasks.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
      const keepIds = new Set(
        sorted.slice(0, MAX_PERSISTED_TASKS).map((item) => item.taskId)
      );
      for (const existingId of Array.from(this.tasks.keys())) {
        if (!keepIds.has(existingId)) {
          this.tasks.delete(existingId);
          this.pendingQueue.delete(existingId);
        }
      }
    }
    this.persistToDisk();
  }

  private persistToDisk(): void {
    if (!this.persistPath) {
      return;
    }
    try {
      const entries = Array.from(this.tasks.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
      writeJsonAtomic(this.persistPath, {
        schemaVersion: 1,
        tasks: entries
      });
    } catch {
      // Persistence errors should not crash active dispatch flow.
    }
  }

  private hydrateFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) {
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.persistPath, "utf8")) as {
        tasks?: unknown;
      };
      if (!Array.isArray(parsed.tasks)) {
        return;
      }
      for (const raw of parsed.tasks) {
        if (
          isPlainObject(raw) &&
          typeof raw["taskId"] === "string" &&
          typeof raw["prompt"] === "string" &&
          typeof raw["workspacePath"] === "string"
        ) {
          const envelope = raw as unknown as PrismuxDispatchEnvelope;
          this.tasks.set(envelope.taskId, envelope);
          if (
            envelope.status === "queued" ||
            envelope.status === "awaiting_human_confirmation"
          ) {
            this.pendingQueue.set(envelope.taskId, envelope);
          }
        }
      }
    } catch {
      // Ignore corrupt persisted dispatch file cleanly.
    }
  }
}
