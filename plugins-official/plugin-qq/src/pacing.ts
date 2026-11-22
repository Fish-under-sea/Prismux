export interface GroupPacingConfig {
  cooldownMs: number;
  keywords: string[];
  randomChimeProbability: number;
  maxSegmentsPerReply?: number;
  maxCharsPerSegment?: number;
  baseTypingDelayMs?: number;
  perCharDelayMs?: number;
  maxSegmentDelayMs?: number;
}

export interface GroupMessageSignal {
  groupId: string;
  userId: string;
  text: string;
  mentionsBot: boolean;
  timestamp?: number;
}

export type GroupPacingTriggerReason =
  | "at_mention"
  | "keyword_match"
  | "random_chime"
  | "cooldown_suppressed"
  | "no_trigger";

export interface GroupPacingDecision {
  shouldReply: boolean;
  reason: GroupPacingTriggerReason;
  matchedKeyword?: string;
  cooldownRemainingMs: number;
  bypassedCooldown: boolean;
}

export interface HumanReplySegment {
  index: number;
  text: string;
  delayMs: number;
  cumulativeDelayMs: number;
}

export interface SplitHumanSegmentsOptions {
  maxSegments?: number;
  maxCharsPerSegment?: number;
  baseTypingDelayMs?: number;
  perCharDelayMs?: number;
  maxSegmentDelayMs?: number;
}

export const DEFAULT_GROUP_PACING_CONFIG: GroupPacingConfig = {
  cooldownMs: 15_000,
  keywords: ["棱镜", "Prismux", "早报", "帮忙", "代码", "构建"],
  randomChimeProbability: 0.08,
  maxSegmentsPerReply: 5,
  maxCharsPerSegment: 46,
  baseTypingDelayMs: 320,
  perCharDelayMs: 42,
  maxSegmentDelayMs: 2400
};

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function splitLongClause(clause: string, maxChars: number): string[] {
  const trimmed = clause.trim();
  if (trimmed.length <= maxChars) {
    return trimmed.length > 0 ? [trimmed] : [];
  }

  const subParts: string[] = [];
  let buffer = "";
  const clausePieces = trimmed.split(/(?<=[，,、：:])\s*/);

  for (const piece of clausePieces) {
    const cleanPiece = piece.trim();
    if (cleanPiece.length === 0) {
      continue;
    }
    if (buffer.length === 0) {
      buffer = cleanPiece;
    } else if (buffer.length + 1 + cleanPiece.length <= maxChars) {
      buffer = `${buffer} ${cleanPiece}`;
    } else {
      subParts.push(buffer);
      buffer = cleanPiece;
    }
  }
  if (buffer.length > 0) {
    subParts.push(buffer);
  }

  const finalParts: string[] = [];
  for (const part of subParts) {
    if (part.length <= maxChars) {
      finalParts.push(part);
      continue;
    }
    let remaining = part;
    while (remaining.length > maxChars) {
      let cut = remaining.lastIndexOf(" ", maxChars);
      if (cut < Math.floor(maxChars * 0.45)) {
        // Avoid slicing through a protected placeholder token (__PMX_TOK_n__).
        const tokenBoundary = remaining.slice(0, maxChars).lastIndexOf("__PMX_TOK_");
        if (tokenBoundary > 0) {
          cut = tokenBoundary;
        } else if (remaining.startsWith("__PMX_TOK_")) {
          const closingIdx = remaining.indexOf("__", "__PMX_TOK_".length);
          cut = closingIdx > 0 ? closingIdx + 2 : maxChars;
        } else {
          cut = maxChars;
        }
      }
      const head = remaining.slice(0, cut).trim();
      if (head.length > 0) {
        finalParts.push(head);
      }
      remaining = remaining.slice(cut).trim();
      if (head.length === 0) {
        break;
      }
    }
    if (remaining.length > 0) {
      finalParts.push(remaining);
    }
  }

  return finalParts;
}

/**
 * Splits a conversational reply into short, human-like segments and plans
 * natural typing delays while protecting URLs, file paths, and version numbers.
 */
export function splitHumanSegments(
  replyText: string,
  options?: SplitHumanSegmentsOptions
): HumanReplySegment[] {
  const trimmed = replyText.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const maxSegments = Math.max(1, Math.floor(options?.maxSegments ?? 5));
  const maxCharsPerSegment = Math.max(16, Math.floor(options?.maxCharsPerSegment ?? 46));
  const baseTypingDelayMs = Math.max(40, Math.floor(options?.baseTypingDelayMs ?? 320));
  const perCharDelayMs = Math.max(5, Math.floor(options?.perCharDelayMs ?? 42));
  const maxSegmentDelayMs = Math.max(
    baseTypingDelayMs,
    Math.floor(options?.maxSegmentDelayMs ?? 2400)
  );

  // Protect URLs, file names, and decimal/version numbers from mid-token splitting.
  const protectedTokens: string[] = [];
  const masked = trimmed.replace(
    /https?:\/\/[^\s，。！？；：、（）()【】[\]"'<>]+|[a-zA-Z0-9_/-]+(?:\.[a-zA-Z0-9_-]+)+/g,
    (match) => {
      const tokenId = `__PMX_TOK_${protectedTokens.length}__`;
      protectedTokens.push(match);
      return tokenId;
    }
  );

  const restoreTokens = (text: string): string =>
    text.replace(/__PMX_TOK_(\d+)__/g, (_full, idxStr: string) => {
      const idx = Number(idxStr);
      return protectedTokens[idx] ?? "";
    });

  const lines = masked
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const rawSentences: string[] = [];
  for (const line of lines) {
    const parts = line
      .split(/(?<=[。！？～~…；;])|(?<=[.!?])(?=\s|$)/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    for (const part of parts) {
      for (const piece of splitLongClause(part, maxCharsPerSegment)) {
        const restored = restoreTokens(piece).trim();
        if (restored.length > 0) {
          rawSentences.push(restored);
        }
      }
    }
  }

  if (rawSentences.length === 0) {
    rawSentences.push(trimmed);
  }

  // Merge tiny trailing punctuation-only fragments into the previous segment.
  const merged: string[] = [];
  for (const sentence of rawSentences) {
    const lastIdx = merged.length - 1;
    if (
      lastIdx >= 0 &&
      /^[~～!！?？。…、，,.]+$/.test(sentence)
    ) {
      merged[lastIdx] = `${merged[lastIdx] ?? ""}${sentence}`;
    } else {
      merged.push(sentence);
    }
  }

  // Cap segment count without dropping any trailing content.
  if (merged.length > maxSegments) {
    const head = merged.slice(0, maxSegments - 1);
    const tail = merged.slice(maxSegments - 1).join(" ");
    merged.length = 0;
    merged.push(...head, tail);
  }

  let cumulativeDelayMs = 0;
  return merged.map((text, index) => {
    const rawDelay = baseTypingDelayMs + text.length * perCharDelayMs;
    const delayMs = Math.min(maxSegmentDelayMs, rawDelay);
    cumulativeDelayMs += delayMs;
    return {
      index,
      text,
      delayMs,
      cumulativeDelayMs
    };
  });
}

export interface GroupPacingEvaluateOptions {
  randomFn?: () => number;
  dryRun?: boolean;
}

/**
 * Anti-spam human-like group pacing engine:
 * 1) `@` bot mentions always reply (bypassing cooldown);
 * 2) Non-mention replies are suppressed inside the group `cooldownMs` window;
 * 3) Matches configured keywords or triggers random chime-ins by probability;
 * 4) Splits replies into timed natural short segments and tracks timers for clean disposal.
 */
export class GroupPacingEngine {
  private config: GroupPacingConfig;
  private readonly lastReplyByGroup = new Map<string, number>();
  private readonly activeTimers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(config?: Partial<GroupPacingConfig>) {
    this.config = {
      cooldownMs: Math.max(0, config?.cooldownMs ?? DEFAULT_GROUP_PACING_CONFIG.cooldownMs),
      keywords: [...(config?.keywords ?? DEFAULT_GROUP_PACING_CONFIG.keywords)],
      randomChimeProbability: clampProbability(
        config?.randomChimeProbability ?? DEFAULT_GROUP_PACING_CONFIG.randomChimeProbability
      ),
      maxSegmentsPerReply:
        config?.maxSegmentsPerReply ?? DEFAULT_GROUP_PACING_CONFIG.maxSegmentsPerReply,
      maxCharsPerSegment:
        config?.maxCharsPerSegment ?? DEFAULT_GROUP_PACING_CONFIG.maxCharsPerSegment,
      baseTypingDelayMs:
        config?.baseTypingDelayMs ?? DEFAULT_GROUP_PACING_CONFIG.baseTypingDelayMs,
      perCharDelayMs:
        config?.perCharDelayMs ?? DEFAULT_GROUP_PACING_CONFIG.perCharDelayMs,
      maxSegmentDelayMs:
        config?.maxSegmentDelayMs ?? DEFAULT_GROUP_PACING_CONFIG.maxSegmentDelayMs
    };
  }

  getConfig(): GroupPacingConfig {
    return {
      ...this.config,
      keywords: [...this.config.keywords]
    };
  }

  updateConfig(partial: Partial<GroupPacingConfig>): void {
    this.config = {
      ...this.config,
      ...partial,
      cooldownMs:
        partial.cooldownMs !== undefined
          ? Math.max(0, partial.cooldownMs)
          : this.config.cooldownMs,
      keywords:
        partial.keywords !== undefined
          ? [...partial.keywords]
          : [...this.config.keywords],
      randomChimeProbability:
        partial.randomChimeProbability !== undefined
          ? clampProbability(partial.randomChimeProbability)
          : this.config.randomChimeProbability
    };
  }

  getCooldownRemainingMs(groupId: string, now = Date.now()): number {
    const lastReplyAt = this.lastReplyByGroup.get(groupId);
    if (lastReplyAt === undefined) {
      return 0;
    }
    const elapsed = now - lastReplyAt;
    if (elapsed >= this.config.cooldownMs) {
      return 0;
    }
    return Math.max(0, this.config.cooldownMs - elapsed);
  }

  markReplied(groupId: string, now = Date.now()): void {
    this.lastReplyByGroup.set(groupId, now);
  }

  resetGroupCooldown(groupId: string): void {
    this.lastReplyByGroup.delete(groupId);
  }

  evaluate(
    signal: GroupMessageSignal,
    options?: GroupPacingEvaluateOptions
  ): GroupPacingDecision {
    const now = signal.timestamp ?? Date.now();
    const cooldownRemainingMs = this.getCooldownRemainingMs(signal.groupId, now);
    const inCooldown = cooldownRemainingMs > 0;
    const dryRun = options?.dryRun === true;

    if (signal.mentionsBot) {
      if (!dryRun) {
        this.lastReplyByGroup.set(signal.groupId, now);
      }
      return {
        shouldReply: true,
        reason: "at_mention",
        cooldownRemainingMs: 0,
        bypassedCooldown: inCooldown
      };
    }

    if (inCooldown) {
      return {
        shouldReply: false,
        reason: "cooldown_suppressed",
        cooldownRemainingMs,
        bypassedCooldown: false
      };
    }

    const lowerText = signal.text.toLowerCase();
    for (const keyword of this.config.keywords) {
      const normalized = keyword.trim();
      if (normalized.length > 0 && lowerText.includes(normalized.toLowerCase())) {
        if (!dryRun) {
          this.lastReplyByGroup.set(signal.groupId, now);
        }
        return {
          shouldReply: true,
          reason: "keyword_match",
          matchedKeyword: normalized,
          cooldownRemainingMs: 0,
          bypassedCooldown: false
        };
      }
    }

    const randomFn = options?.randomFn ?? Math.random;
    const probability = this.config.randomChimeProbability;
    if (probability > 0 && signal.text.trim().length > 0 && randomFn() < probability) {
      if (!dryRun) {
        this.lastReplyByGroup.set(signal.groupId, now);
      }
      return {
        shouldReply: true,
        reason: "random_chime",
        cooldownRemainingMs: 0,
        bypassedCooldown: false
      };
    }

    return {
      shouldReply: false,
      reason: "no_trigger",
      cooldownRemainingMs: 0,
      bypassedCooldown: false
    };
  }

  planSegments(replyText: string): HumanReplySegment[] {
    return splitHumanSegments(replyText, {
      maxSegments: this.config.maxSegmentsPerReply,
      maxCharsPerSegment: this.config.maxCharsPerSegment,
      baseTypingDelayMs: this.config.baseTypingDelayMs,
      perCharDelayMs: this.config.perCharDelayMs,
      maxSegmentDelayMs: this.config.maxSegmentDelayMs
    });
  }

  async dispatchSegmentedReply(
    replyText: string,
    sendSegment: (segment: HumanReplySegment) => Promise<void> | void,
    options?: { immediate?: boolean }
  ): Promise<HumanReplySegment[]> {
    if (this.disposed) {
      return [];
    }
    const segments = this.planSegments(replyText);
    for (const segment of segments) {
      if (this.disposed) {
        break;
      }
      if (!options?.immediate && segment.delayMs > 0) {
        const continued = await this.waitDelay(segment.delayMs);
        if (!continued || this.disposed) {
          break;
        }
      }
      await sendSegment(segment);
    }
    return segments;
  }

  getActiveTimerCount(): number {
    return this.activeTimers.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of Array.from(this.activeTimers)) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.lastReplyByGroup.clear();
  }

  private waitDelay(delayMs: number): Promise<boolean> {
    if (this.disposed) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.activeTimers.delete(timer);
        resolve(!this.disposed);
      }, delayMs);
      this.activeTimers.add(timer);
    });
  }
}
