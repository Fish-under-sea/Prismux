/**
 * Standard Continue command dispatched when the prompt box is submitted empty.
 */
export const STANDARD_CONTINUE_COMMAND = "继续执行（Continue）" as const;

export type SubmissionTrigger = "button" | "enter" | "shortcut" | "capsule";

export interface SubmissionIntent {
  text: string;
  isAutoContinue: boolean;
  trigger: SubmissionTrigger;
  threadId: string;
}

export type LatchRejectReason =
  | "accepted"
  | "duplicate_inflight"
  | "duplicate_cooldown";

export interface LatchAcceptResult {
  accepted: boolean;
  reason: LatchRejectReason;
  submissionId: string | null;
  intent: SubmissionIntent;
}

export interface EmptyContinueLatchOptions {
  /** Minimum deduplication cooldown window for rapid double-clicks or repeated hotkeys. */
  cooldownMs?: number;
  /** Clock provider for deterministic testing. */
  now?: () => number;
}

/**
 * Normalizes a raw user prompt into a concrete submission intent.
 * Empty / whitespace-only input becomes the standard Continue command.
 */
export function resolvePromptSubmission(
  rawInput: string,
  trigger: SubmissionTrigger = "button",
  threadId = "chief"
): SubmissionIntent {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return {
      text: STANDARD_CONTINUE_COMMAND,
      isAutoContinue: true,
      trigger,
      threadId
    };
  }
  return {
    text: trimmed,
    isAutoContinue: false,
    trigger,
    threadId
  };
}

/**
 * Single-path idempotent submission latch preventing rapid button double-clicks
 * or simultaneous Enter + button triggers from dispatching duplicate Continue runs.
 */
export class EmptyContinueSubmissionLatch {
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly inflightIds = new Map<string, string>();
  private readonly lastAcceptedAt = new Map<string, number>();
  private sequence = 0;

  constructor(options: EmptyContinueLatchOptions = {}) {
    this.cooldownMs = Math.max(0, options.cooldownMs ?? 450);
    this.now = options.now ?? (() => Date.now());
  }

  private buildDedupeKey(intent: SubmissionIntent): string {
    if (intent.isAutoContinue) {
      return `${intent.threadId}::__AUTO_CONTINUE__`;
    }
    return `${intent.threadId}::TEXT::${intent.text}`;
  }

  /**
   * Attempts to acquire the single-path latch for a submission.
   */
  tryBegin(
    rawInput: string,
    options: { trigger?: SubmissionTrigger; threadId?: string } = {}
  ): LatchAcceptResult {
    const trigger = options.trigger ?? "button";
    const threadId = options.threadId ?? "chief";
    const intent = resolvePromptSubmission(rawInput, trigger, threadId);
    const dedupeKey = this.buildDedupeKey(intent);
    const currentMs = this.now();

    if (this.inflightIds.has(dedupeKey)) {
      return {
        accepted: false,
        reason: "duplicate_inflight",
        submissionId: null,
        intent
      };
    }

    const previousTs = this.lastAcceptedAt.get(dedupeKey);
    if (
      previousTs !== undefined &&
      currentMs - previousTs < this.cooldownMs
    ) {
      return {
        accepted: false,
        reason: "duplicate_cooldown",
        submissionId: null,
        intent
      };
    }

    this.sequence += 1;
    const submissionId = `sub-${this.sequence}`;
    this.inflightIds.set(dedupeKey, submissionId);
    this.lastAcceptedAt.set(dedupeKey, currentMs);

    return {
      accepted: true,
      reason: "accepted",
      submissionId,
      intent
    };
  }

  /**
   * Marks an accepted submission as completed, releasing its inflight lock
   * while keeping the cooldown timestamp active to block immediate bounce clicks.
   */
  complete(submissionId: string): void {
    for (const [key, activeId] of this.inflightIds.entries()) {
      if (activeId === submissionId) {
        this.inflightIds.delete(key);
      }
    }
  }

  /**
   * Returns true if any submission (or a specific thread's submission) is currently in flight.
   */
  isInflight(threadId?: string): boolean {
    if (threadId === undefined) {
      return this.inflightIds.size > 0;
    }
    const prefix = `${threadId}::`;
    for (const key of this.inflightIds.keys()) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Executes an async or sync submission callback strictly once per accepted latch pass.
   */
  async submitOnce<T>(
    rawInput: string,
    executor: (intent: SubmissionIntent) => Promise<T> | T,
    options: { trigger?: SubmissionTrigger; threadId?: string } = {}
  ): Promise<
    | { executed: true; result: T; latch: LatchAcceptResult }
    | { executed: false; latch: LatchAcceptResult }
  > {
    const latch = this.tryBegin(rawInput, options);
    if (!latch.accepted || latch.submissionId === null) {
      return { executed: false, latch };
    }
    try {
      const result = await executor(latch.intent);
      return { executed: true, result, latch };
    } finally {
      this.complete(latch.submissionId);
    }
  }

  reset(): void {
    this.inflightIds.clear();
    this.lastAcceptedAt.clear();
  }
}
