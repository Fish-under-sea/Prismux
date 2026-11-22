import {
  DIAL_MODE_DESCRIPTIONS,
  type DialMode,
  type HandoffRequest,
  type HandoffResult,
  type HandoffSummary
} from "@prismux/protocol";

export interface HandoffEngineOptions {
  defaultDialMode?: DialMode;
}

/**
 * Amp-inspired `/handoff` distillation engine + 3-mode Dial (`agent` | `oracle` | `review`).
 * Distills long threads into `{ goal, decisions, touchedFiles, openQuestions }` and opens a fresh thread.
 */
export class HandoffEngine {
  private readonly threadDialModes = new Map<string, DialMode>();
  private readonly defaultDialMode: DialMode;

  constructor(options?: HandoffEngineOptions) {
    this.defaultDialMode = options?.defaultDialMode ?? "agent";
  }

  getDialMode(threadId: string): DialMode {
    return this.threadDialModes.get(threadId) ?? this.defaultDialMode;
  }

  setDialMode(threadId: string, mode: DialMode): DialMode {
    this.threadDialModes.set(threadId, mode);
    return mode;
  }

  isReadOnlyMode(mode: DialMode): boolean {
    return DIAL_MODE_DESCRIPTIONS[mode].readOnly;
  }

  createEmptySummary(goal: string): HandoffSummary {
    return {
      goal,
      decisions: [],
      touchedFiles: [],
      openQuestions: []
    };
  }

  async executeHandoff(request: HandoffRequest): Promise<HandoffResult> {
    const dialMode = request.targetDialMode ?? this.defaultDialMode;
    const newThreadId = `handoff-${Date.now()}`;
    this.setDialMode(newThreadId, dialMode);

    return {
      sourceThreadId: request.sourceThreadId,
      newThreadId,
      dialMode,
      summary: this.createEmptySummary(
        request.additionalContext ?? `Continuation from ${request.sourceThreadId}`
      ),
      createdAt: Date.now()
    };
  }
}
