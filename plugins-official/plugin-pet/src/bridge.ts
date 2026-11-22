import { randomUUID } from "node:crypto";
import {
  PET_ACTION_NAMESPACE,
  type IssuedPetLeaseToken,
  type PetActionInput,
  type PetActionRequest,
  type PetActionResult,
  type PetBridgeControllerOptions,
  type PetBubbleState,
  type PetGlobalConfig,
  type PetHandoverResult,
  type PetInstanceMeta,
  type PetInstanceSnapshot,
  type PetLeaseRejectReason,
  type PetLeaseReleaseResult,
  type PetLeaseRenewResult,
  type PetLeaseToken,
  type PetMotionState,
  type PetNamespaceActionHandler,
  type PetOwnerKind,
  type PetPlaybackProgress,
  type PetProgressListener
} from "./types.js";

const DEFAULT_LEASE_TTL_MS = 30_000;

export function isLeaseValid(lease: PetLeaseToken, now = Date.now()): boolean {
  return Number.isFinite(lease.expiresAt) && lease.expiresAt > now;
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T> {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const obj = value as object;
  if (seen.has(obj)) {
    return value;
  }
  seen.add(obj);

  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item, seen);
    }
  } else {
    for (const prop of Object.values(value as Record<string, unknown>)) {
      deepFreeze(prop, seen);
    }
  }

  return Object.freeze(value);
}

function clonePlain<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }
  return structuredClone(value);
}

export class PetUnknownInstanceError extends Error {
  readonly code = "unknown_instance" as const;
  readonly instanceId: string;

  constructor(instanceId: string) {
    super(`Pet instance "${instanceId}" is not registered.`);
    this.name = "PetUnknownInstanceError";
    this.instanceId = instanceId;
  }
}

export class PetNamespaceViolationError extends Error {
  readonly actionName: string;

  constructor(actionName: string) {
    super(
      `Extension action "${actionName}" must reside within "${PET_ACTION_NAMESPACE}.*" namespace.`
    );
    this.name = "PetNamespaceViolationError";
    this.actionName = actionName;
  }
}

interface InternalPetInstance {
  instanceId: string;
  meta: Readonly<PetInstanceMeta>;
  motionOwner: PetOwnerKind;
  bubbleOwner: PetOwnerKind;
  activeMotion: PetMotionState | null;
  activeBubble: PetBubbleState | null;
  activeLease: IssuedPetLeaseToken | null;
  generationCounter: number;
  registeredAt: number;
  updatedAt: number;
}

interface ProgressSubscriptionEntry {
  listener: PetProgressListener;
  instanceId?: string;
}

/**
 * Implements the `dsh-pet Issue #122` bridge contract:
 * - Directed multi-instance binding (`registerInstance` / per-instance routing)
 * - Monotonic-generation lease lock with expiry (`stale_lease` / `expired_lease`)
 * - Frozen read-only playback progress subscriptions (`Object.freeze`)
 * - Staged independent handover (`handoverMotion` preserves bubble; `handoverBubble` clears it)
 * - Isolated `prismux.pet.*` action namespace and immutable `globalConfig`
 */
export class PetBridgeController {
  private readonly defaultLeaseTtlMs: number;
  private readonly nowFn: () => number;
  private readonly frozenGlobalConfig: Readonly<PetGlobalConfig>;

  private readonly instances = new Map<string, InternalPetInstance>();
  private readonly subscribers = new Set<ProgressSubscriptionEntry>();
  private readonly progressSnapshots = new Map<string, Readonly<PetPlaybackProgress>>();
  private readonly namespaceActions = new Map<string, PetNamespaceActionHandler<unknown, unknown>>();
  private readonly bubbleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private latestGlobalProgress: Readonly<PetPlaybackProgress> | null = null;
  private disposed = false;

  constructor(options?: PetBridgeControllerOptions) {
    const ttl = options?.defaultLeaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new RangeError("defaultLeaseTtlMs must be a positive finite number.");
    }
    this.defaultLeaseTtlMs = Math.floor(ttl);
    this.nowFn = options?.nowFn ?? (() => Date.now());
    this.frozenGlobalConfig = deepFreeze(clonePlain(options?.globalConfig ?? {}));

    this.registerDefaultNamespaceActions();
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getGlobalConfig(): Readonly<PetGlobalConfig> {
    return this.frozenGlobalConfig;
  }

  registerInstance(
    instanceId: string,
    meta?: PetInstanceMeta
  ): PetInstanceSnapshot {
    this.assertNotDisposed();
    const cleanId = instanceId.trim();
    if (cleanId.length === 0) {
      throw new Error("instanceId must be a non-empty string.");
    }

    const now = this.nowFn();
    const existing = this.instances.get(cleanId);
    if (existing !== undefined) {
      if (meta !== undefined) {
        existing.meta = deepFreeze(clonePlain(meta));
      }
      existing.updatedAt = now;
      return this.toSnapshot(existing);
    }

    const created: InternalPetInstance = {
      instanceId: cleanId,
      meta: deepFreeze(clonePlain(meta ?? {})),
      motionOwner: "native",
      bubbleOwner: "native",
      activeMotion: null,
      activeBubble: null,
      activeLease: null,
      generationCounter: 0,
      registeredAt: now,
      updatedAt: now
    };
    this.instances.set(cleanId, created);
    return this.toSnapshot(created);
  }

  unregisterInstance(instanceId: string): boolean {
    this.clearBubbleTimer(instanceId);
    this.progressSnapshots.delete(instanceId);
    return this.instances.delete(instanceId);
  }

  getInstance(instanceId: string): PetInstanceSnapshot | undefined {
    const found = this.instances.get(instanceId);
    return found ? this.toSnapshot(found) : undefined;
  }

  listInstances(): PetInstanceSnapshot[] {
    return Array.from(this.instances.values(), (entry) =>
      this.toSnapshot(entry)
    );
  }

  acquireLease(
    instanceId: string,
    options?: { ttlMs?: number; ownerId?: string; now?: number }
  ): Readonly<IssuedPetLeaseToken> {
    this.assertNotDisposed();
    const instance = this.instances.get(instanceId);
    if (instance === undefined) {
      throw new PetUnknownInstanceError(instanceId);
    }

    const now = options?.now ?? this.nowFn();
    const ttlMs = options?.ttlMs ?? this.defaultLeaseTtlMs;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError("Lease ttlMs must be a positive finite number.");
    }

    instance.generationCounter += 1;
    const generation = instance.generationCounter;
    const lease: IssuedPetLeaseToken = {
      leaseId: `pet-lease-${instanceId}-g${generation}-${randomUUID().slice(0, 8)}`,
      instanceId,
      generation,
      acquiredAt: now,
      expiresAt: now + Math.floor(ttlMs),
      ownerId: options?.ownerId
    };

    instance.activeLease = lease;
    instance.updatedAt = now;
    return Object.freeze({ ...lease });
  }

  renewLease(
    instanceId: string,
    leaseOrId: string | PetLeaseToken,
    ttlMs?: number,
    now = this.nowFn()
  ): PetLeaseRenewResult {
    const check = this.validateLease(instanceId, leaseOrId, now);
    if (!check.ok) {
      return {
        accepted: false,
        reason: check.reason
      };
    }

    const effectiveTtl = ttlMs ?? this.defaultLeaseTtlMs;
    if (!Number.isFinite(effectiveTtl) || effectiveTtl <= 0) {
      throw new RangeError("Lease ttlMs must be a positive finite number.");
    }

    check.lease.expiresAt = now + Math.floor(effectiveTtl);
    check.instance.updatedAt = now;

    return {
      accepted: true,
      lease: Object.freeze({ ...check.lease })
    };
  }

  releaseLease(
    instanceId: string,
    leaseOrId: string | PetLeaseToken,
    now = this.nowFn()
  ): PetLeaseReleaseResult {
    const check = this.validateLease(instanceId, leaseOrId, now);
    if (!check.ok) {
      return {
        released: false,
        reason: check.reason
      };
    }

    check.instance.activeLease = null;
    check.instance.updatedAt = now;
    return { released: true };
  }

  executeAction(request: PetActionRequest): PetActionResult;
  executeAction(
    instanceId: string,
    leaseOrId: string | PetLeaseToken,
    action: PetActionInput,
    now?: number
  ): PetActionResult;
  executeAction(
    instanceIdOrRequest: string | PetActionRequest,
    leaseOrIdArg?: string | PetLeaseToken,
    actionArg?: PetActionInput,
    nowArg?: number
  ): PetActionResult {
    let instanceId: string;
    let leaseOrId: string | PetLeaseToken;
    let action: PetActionInput;
    let now: number;

    if (typeof instanceIdOrRequest === "string") {
      instanceId = instanceIdOrRequest;
      leaseOrId = leaseOrIdArg ?? "";
      action = actionArg ?? {};
      now = nowArg ?? this.nowFn();
    } else {
      instanceId = instanceIdOrRequest.instanceId;
      leaseOrId =
        instanceIdOrRequest.lease ?? instanceIdOrRequest.leaseId ?? "";
      action = instanceIdOrRequest.action;
      now = instanceIdOrRequest.now ?? this.nowFn();
    }

    const check = this.validateLease(instanceId, leaseOrId, now);
    if (!check.ok) {
      return {
        accepted: false,
        reason: check.reason,
        instanceId
      };
    }

    const { instance, lease } = check;
    if (action.motion !== undefined || action.playbackId !== undefined) {
      instance.motionOwner = "plugin";
      instance.activeMotion = {
        motionName: action.motion ?? "playback",
        playbackId: action.playbackId,
        startedAt: now
      };
    }

    const bubbleText = action.bubble?.text ?? action.bubbleText;
    if (bubbleText !== undefined) {
      instance.bubbleOwner = "plugin";
      instance.activeBubble = {
        text: bubbleText,
        kind: action.bubble?.kind ?? action.bubbleKind,
        deepLink: action.bubble?.deepLink ?? action.deepLink,
        updatedAt: now
      };
    }

    instance.updatedAt = now;

    return {
      accepted: true,
      instanceId,
      leaseId: lease.leaseId,
      generation: lease.generation,
      motionOwner: instance.motionOwner,
      bubbleOwner: instance.bubbleOwner,
      activeMotion: instance.activeMotion
        ? Object.freeze({ ...instance.activeMotion })
        : null,
      activeBubble: instance.activeBubble
        ? Object.freeze({ ...instance.activeBubble })
        : null
    };
  }

  /**
   * Stage 1 handover: returns `motionOwner` to `"native"` so the mascot resumes
   * native idle/roam motion, while intentionally preserving `activeBubble` and `bubbleOwner`.
   */
  handoverMotion(
    instanceId: string,
    leaseOrId: string | PetLeaseToken,
    now = this.nowFn()
  ): PetHandoverResult {
    const check = this.validateLease(instanceId, leaseOrId, now);
    if (!check.ok) {
      const existing = this.instances.get(instanceId);
      return {
        accepted: false,
        reason: check.reason,
        instanceId,
        motionOwner: existing?.motionOwner,
        bubbleOwner: existing?.bubbleOwner,
        bubblePreserved: existing?.activeBubble !== null && existing?.activeBubble !== undefined,
        activeBubble: existing?.activeBubble
          ? Object.freeze({ ...existing.activeBubble })
          : null
      };
    }

    const { instance } = check;
    instance.motionOwner = "native";
    instance.activeMotion = null;
    instance.updatedAt = now;

    return {
      accepted: true,
      instanceId,
      motionOwner: "native",
      bubbleOwner: instance.bubbleOwner,
      bubblePreserved: instance.activeBubble !== null,
      activeBubble: instance.activeBubble
        ? Object.freeze({ ...instance.activeBubble })
        : null
    };
  }

  /**
   * Stage 2 handover: releases the retained bubble text and returns `bubbleOwner` to `"native"`.
   */
  handoverBubble(
    instanceId: string,
    leaseOrId: string | PetLeaseToken,
    now = this.nowFn()
  ): PetHandoverResult {
    const check = this.validateLease(instanceId, leaseOrId, now);
    if (!check.ok) {
      const existing = this.instances.get(instanceId);
      return {
        accepted: false,
        reason: check.reason,
        instanceId,
        motionOwner: existing?.motionOwner,
        bubbleOwner: existing?.bubbleOwner,
        bubblePreserved: existing?.activeBubble !== null && existing?.activeBubble !== undefined,
        activeBubble: existing?.activeBubble
          ? Object.freeze({ ...existing.activeBubble })
          : null
      };
    }

    const { instance } = check;
    this.clearBubbleTimer(instanceId);
    instance.activeBubble = null;
    instance.bubbleOwner = "native";
    instance.updatedAt = now;

    return {
      accepted: true,
      instanceId,
      motionOwner: instance.motionOwner,
      bubbleOwner: "native",
      bubblePreserved: false,
      activeBubble: null
    };
  }

  dismissBubbleByUser(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (instance === undefined) {
      return false;
    }
    this.clearBubbleTimer(instanceId);
    instance.activeBubble = null;
    instance.bubbleOwner = "native";
    instance.updatedAt = this.nowFn();
    return true;
  }

  scheduleBubbleHandoverTimeout(
    instanceId: string,
    leaseOrId: string | PetLeaseToken,
    delayMs: number
  ): void {
    this.assertNotDisposed();
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError("Bubble handover delayMs must be >= 0.");
    }
    this.clearBubbleTimer(instanceId);
    const timer = setTimeout(() => {
      this.bubbleTimers.delete(instanceId);
      if (!this.disposed) {
        this.handoverBubble(instanceId, leaseOrId);
      }
    }, delayMs);
    this.bubbleTimers.set(instanceId, timer);
  }

  subscribePlaybackProgress(
    listener: PetProgressListener,
    options?: { instanceId?: string }
  ): () => void {
    this.assertNotDisposed();
    const entry: ProgressSubscriptionEntry = {
      listener,
      instanceId: options?.instanceId
    };
    this.subscribers.add(entry);
    return () => {
      this.subscribers.delete(entry);
    };
  }

  emitPlaybackProgress(
    progress: PetPlaybackProgress,
    instanceId?: string
  ): Readonly<PetPlaybackProgress> {
    this.assertNotDisposed();
    if (typeof progress.playbackId !== "string" || progress.playbackId.trim().length === 0) {
      throw new Error("playbackId must be a non-empty string.");
    }
    if (!Number.isFinite(progress.currentTime) || progress.currentTime < 0) {
      throw new RangeError("currentTime must be a finite number >= 0.");
    }
    if (!Number.isFinite(progress.duration) || progress.duration < 0) {
      throw new RangeError("duration must be a finite number >= 0.");
    }

    const snapshot: Readonly<PetPlaybackProgress> = Object.freeze({
      playbackId: progress.playbackId,
      currentTime: progress.currentTime,
      duration: progress.duration,
      buffering: Boolean(progress.buffering)
    });

    this.latestGlobalProgress = snapshot;
    if (instanceId !== undefined) {
      this.progressSnapshots.set(instanceId, snapshot);
    }

    const meta = Object.freeze({ instanceId });
    for (const sub of Array.from(this.subscribers)) {
      if (sub.instanceId !== undefined && sub.instanceId !== instanceId) {
        continue;
      }
      try {
        sub.listener(snapshot, meta);
      } catch {
        // Subscriber faults or strict-mode readonly mutation attempts are isolated.
      }
    }

    return snapshot;
  }

  getLastPlaybackProgress(
    instanceId?: string
  ): Readonly<PetPlaybackProgress> | null {
    if (instanceId !== undefined) {
      return this.progressSnapshots.get(instanceId) ?? null;
    }
    return this.latestGlobalProgress;
  }

  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  registerNamespaceAction<TInput = unknown, TOutput = unknown>(
    actionName: string,
    handler: PetNamespaceActionHandler<TInput, TOutput>
  ): void {
    this.assertNotDisposed();
    if (!actionName.startsWith(`${PET_ACTION_NAMESPACE}.`)) {
      throw new PetNamespaceViolationError(actionName);
    }
    this.namespaceActions.set(
      actionName,
      handler as PetNamespaceActionHandler<unknown, unknown>
    );
  }

  invokeNamespaceAction<TOutput = unknown>(
    actionName: string,
    payload?: unknown
  ): TOutput {
    this.assertNotDisposed();
    if (!actionName.startsWith(`${PET_ACTION_NAMESPACE}.`)) {
      throw new PetNamespaceViolationError(actionName);
    }
    const handler = this.namespaceActions.get(actionName);
    if (handler === undefined) {
      throw new Error(`Namespace action "${actionName}" is not registered.`);
    }
    return handler(payload) as TOutput;
  }

  getRegisteredActions(): string[] {
    return Array.from(this.namespaceActions.keys());
  }

  getActiveTimerCount(): number {
    return this.bubbleTimers.size;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    for (const timer of Array.from(this.bubbleTimers.values())) {
      clearTimeout(timer);
    }
    this.bubbleTimers.clear();
    this.subscribers.clear();
    this.progressSnapshots.clear();
    this.latestGlobalProgress = null;
    this.namespaceActions.clear();
    this.instances.clear();
  }

  private registerDefaultNamespaceActions(): void {
    this.registerNamespaceAction(
      `${PET_ACTION_NAMESPACE}.registerInstance`,
      (payload: { instanceId: string; meta?: PetInstanceMeta }) =>
        this.registerInstance(payload.instanceId, payload.meta)
    );
    this.registerNamespaceAction(
      `${PET_ACTION_NAMESPACE}.acquireLease`,
      (payload: { instanceId: string; ttlMs?: number; ownerId?: string }) =>
        this.acquireLease(payload.instanceId, payload)
    );
    this.registerNamespaceAction(
      `${PET_ACTION_NAMESPACE}.renewLease`,
      (payload: { instanceId: string; leaseId: string; ttlMs?: number }) =>
        this.renewLease(payload.instanceId, payload.leaseId, payload.ttlMs)
    );
    this.registerNamespaceAction(
      `${PET_ACTION_NAMESPACE}.releaseLease`,
      (payload: { instanceId: string; leaseId: string }) =>
        this.releaseLease(payload.instanceId, payload.leaseId)
    );
    this.registerNamespaceAction(
      `${PET_ACTION_NAMESPACE}.executeAction`,
      (payload: PetActionRequest) => this.executeAction(payload)
    );
    this.registerNamespaceAction(
      `${PET_ACTION_NAMESPACE}.handoverMotion`,
      (payload: { instanceId: string; leaseId: string }) =>
        this.handoverMotion(payload.instanceId, payload.leaseId)
    );
    this.registerNamespaceAction(
      `${PET_ACTION_NAMESPACE}.handoverBubble`,
      (payload: { instanceId: string; leaseId: string }) =>
        this.handoverBubble(payload.instanceId, payload.leaseId)
    );
    this.registerNamespaceAction(
      `${PET_ACTION_NAMESPACE}.emitPlaybackProgress`,
      (payload: { progress: PetPlaybackProgress; instanceId?: string }) =>
        this.emitPlaybackProgress(payload.progress, payload.instanceId)
    );
  }

  private validateLease(
    instanceId: string,
    leaseOrId: string | PetLeaseToken,
    now: number
  ):
    | { ok: true; instance: InternalPetInstance; lease: IssuedPetLeaseToken }
    | { ok: false; reason: PetLeaseRejectReason } {
    const instance = this.instances.get(instanceId);
    if (instance === undefined) {
      return { ok: false, reason: "unknown_instance" };
    }

    const active = instance.activeLease;
    if (active === null || this.disposed) {
      return { ok: false, reason: "stale_lease" };
    }

    const providedId =
      typeof leaseOrId === "string" ? leaseOrId : leaseOrId.leaseId;
    if (providedId !== active.leaseId) {
      return { ok: false, reason: "stale_lease" };
    }

    if (typeof leaseOrId === "object" && leaseOrId !== null) {
      if (leaseOrId.instanceId !== instanceId) {
        return { ok: false, reason: "stale_lease" };
      }
      if (
        leaseOrId.generation !== undefined &&
        leaseOrId.generation !== active.generation
      ) {
        return { ok: false, reason: "stale_lease" };
      }
    }

    if (!isLeaseValid(active, now)) {
      return { ok: false, reason: "expired_lease" };
    }

    return { ok: true, instance, lease: active };
  }

  private clearBubbleTimer(instanceId: string): void {
    const timer = this.bubbleTimers.get(instanceId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.bubbleTimers.delete(instanceId);
    }
  }

  private toSnapshot(instance: InternalPetInstance): PetInstanceSnapshot {
    return Object.freeze({
      instanceId: instance.instanceId,
      meta: instance.meta,
      motionOwner: instance.motionOwner,
      bubbleOwner: instance.bubbleOwner,
      activeMotion: instance.activeMotion
        ? Object.freeze({ ...instance.activeMotion })
        : null,
      activeBubble: instance.activeBubble
        ? Object.freeze({ ...instance.activeBubble })
        : null,
      activeLease: instance.activeLease
        ? Object.freeze({ ...instance.activeLease })
        : null,
      generationCounter: instance.generationCounter,
      registeredAt: instance.registeredAt,
      updatedAt: instance.updatedAt
    });
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("PetBridgeController has been disposed.");
    }
  }
}
