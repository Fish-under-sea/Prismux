import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import {
  parseTimestampMs,
  tokenCount,
  type ProviderUsageReader,
  type TranscriptUsageFormat,
  type UsageRecord,
} from "@t3tools/provider-core/server/usage";
import * as HostProcess from "@t3tools/shared/HostProcess";

// Claude Code uses this model for local placeholders that never reached the API.
export const CLAUDE_SYNTHETIC_MODEL = "<synthetic>";

const MAX_CLAUDE_CALL_DURATION_MS = 10 * 60 * 1000;

export const ClaudeScanState = Schema.Struct({
  pendingRequestStartedAtMs: Schema.mutableKey(Schema.NullOr(Schema.Finite)),
  activeDedupeKey: Schema.mutableKey(Schema.NullOr(Schema.String)),
  activeStartedAtMs: Schema.mutableKey(Schema.NullOr(Schema.Finite)),
});
export type ClaudeScanState = typeof ClaudeScanState.Type;

export function initialClaudeScanState(): ClaudeScanState {
  return {
    pendingRequestStartedAtMs: null,
    activeDedupeKey: null,
    activeStartedAtMs: null,
  };
}

function readOptionalMs(
  source: Record<string, unknown>,
  keys: readonly string[],
  allowZero: boolean,
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (allowZero ? value >= 0 : value > 0) &&
      value <= 60 * 60 * 1000
    ) {
      return Math.round(value * 100) / 100;
    }
  }
  return null;
}

/**
 * Claude Code repeats a message's `dedupeKey` for each assistant content block.
 * Subagent blocks can progress from stream-start to final usage, so callers
 * must count each key once using the maximum of each token channel.
 */
export function parseClaudeLine(line: string, state?: ClaudeScanState): readonly UsageRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  return parseClaudeRecord(parsed, state);
}

function cacheCreation1h(usage: Record<string, unknown>): { cacheCreation1hTokens?: number } {
  const split = usage["cache_creation"];
  if (typeof split !== "object" || split === null) return {};
  const tokens = tokenCount((split as Record<string, unknown>)["ephemeral_1h_input_tokens"]);
  return tokens > 0 ? { cacheCreation1hTokens: tokens } : {};
}

function parseClaudeRecord(parsed: unknown, state?: ClaudeScanState): readonly UsageRecord[] {
  if (typeof parsed !== "object" || parsed === null) return [];

  const record = parsed as Record<string, unknown>;
  const recordType = record["type"];
  if (recordType === "api-request-shape" || recordType === "user") {
    if (state !== undefined) {
      const requestTimestampMs = parseTimestampMs(record["timestamp"]);
      if (requestTimestampMs !== null) {
        state.pendingRequestStartedAtMs = requestTimestampMs;
      }
    }
    return [];
  }
  if (recordType !== "assistant") return [];

  const message = record["message"];
  if (typeof message !== "object" || message === null) return [];
  const messageRecord = message as Record<string, unknown>;

  const usage = messageRecord["usage"];
  if (typeof usage !== "object" || usage === null) return [];
  const usageRecord = usage as Record<string, unknown>;

  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return [];

  const model = typeof messageRecord["model"] === "string" ? messageRecord["model"] : "";
  if (model.length === 0 || model === CLAUDE_SYNTHETIC_MODEL) return [];

  const messageId = typeof messageRecord["id"] === "string" ? messageRecord["id"] : null;
  const requestId = typeof record["requestId"] === "string" ? record["requestId"] : null;
  const dedupeKey =
    messageId === null && requestId === null ? null : `${messageId ?? ""}:${requestId ?? ""}`;

  const explicitTtftMs =
    readOptionalMs(record, ["ttftMs", "ttft_ms", "time_to_first_token_ms"], true) ??
    readOptionalMs(messageRecord, ["ttftMs", "ttft_ms", "time_to_first_token_ms"], true);
  const explicitDurationMs =
    readOptionalMs(
      record,
      ["durationMs", "duration_ms", "apiDurationMs", "api_duration_ms"],
      false,
    ) ??
    readOptionalMs(
      messageRecord,
      ["durationMs", "duration_ms", "apiDurationMs", "api_duration_ms"],
      false,
    );

  let inferredDurationMs: number | null = null;
  if (state !== undefined) {
    let startedAtMs: number | null;
    if (
      dedupeKey !== null &&
      dedupeKey === state.activeDedupeKey &&
      state.activeStartedAtMs !== null
    ) {
      startedAtMs = state.activeStartedAtMs;
    } else {
      startedAtMs = state.pendingRequestStartedAtMs;
      state.pendingRequestStartedAtMs = null;
      state.activeDedupeKey = dedupeKey;
      state.activeStartedAtMs = startedAtMs;
    }
    if (
      startedAtMs !== null &&
      timestampMs > startedAtMs &&
      timestampMs - startedAtMs <= MAX_CLAUDE_CALL_DURATION_MS
    ) {
      inferredDurationMs = timestampMs - startedAtMs;
    }
  }

  const resolvedDurationMs = explicitDurationMs ?? inferredDurationMs;

  const cost = record["costUSD"];

  const executor: UsageRecord = {
    provider: "claude",
    timestampMs,
    model,
    sessionId: typeof record["sessionId"] === "string" ? record["sessionId"] : "",
    totals: {
      uncachedInputTokens: tokenCount(usageRecord["input_tokens"]),
      cachedInputTokens: tokenCount(usageRecord["cache_read_input_tokens"]),
      cacheCreationTokens: tokenCount(usageRecord["cache_creation_input_tokens"]),
      outputTokens: tokenCount(usageRecord["output_tokens"]),
      // Anthropic folds thinking tokens into output and does not break them out.
      reasoningTokens: 0,
    },
    ...cacheCreation1h(usageRecord),
    reportedCostUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    speed: usageRecord["speed"] === "fast" ? "fast" : "standard",
    dedupeKey,
    ...(explicitTtftMs !== null ? { ttftMs: explicitTtftMs } : {}),
    ...(resolvedDurationMs !== null ? { durationMs: resolvedDurationMs } : {}),
  };

  // Top-level `usage` is the executor's alone. Advisor calls run on another model at its own rates
  // and appear only in `iterations`, so each one is its own record under that model.
  const records = [executor];
  const iterations: readonly unknown[] = Array.isArray(usageRecord["iterations"])
    ? usageRecord["iterations"]
    : [];
  for (const [index, iteration] of iterations.entries()) {
    if (typeof iteration !== "object" || iteration === null) continue;
    const advisor = iteration as Record<string, unknown>;
    if (advisor["type"] !== "advisor_message") continue;

    const advisorModel = typeof advisor["model"] === "string" ? advisor["model"] : "";
    if (advisorModel.length === 0 || advisorModel === CLAUDE_SYNTHETIC_MODEL) continue;

    records.push({
      provider: "claude",
      timestampMs,
      model: advisorModel,
      sessionId: executor.sessionId,
      totals: {
        uncachedInputTokens: tokenCount(advisor["input_tokens"]),
        cachedInputTokens: tokenCount(advisor["cache_read_input_tokens"]),
        cacheCreationTokens: tokenCount(advisor["cache_creation_input_tokens"]),
        outputTokens: tokenCount(advisor["output_tokens"]),
        reasoningTokens: 0,
      },
      ...cacheCreation1h(advisor),
      reportedCostUsd: null,
      speed: executor.speed,
      dedupeKey: dedupeKey === null ? null : `${dedupeKey}:advisor:${index}`,
    });
  }
  return records;
}

export const claudeUsageFormat: TranscriptUsageFormat<ClaudeScanState> = {
  selectFields: {
    type: true,
    timestamp: true,
    requestId: true,
    sessionId: true,
    costUSD: true,
    durationMs: true,
    duration_ms: true,
    apiDurationMs: true,
    api_duration_ms: true,
    ttftMs: true,
    ttft_ms: true,
    time_to_first_token_ms: true,
    message: {
      id: true,
      model: true,
      usage: true,
      durationMs: true,
      duration_ms: true,
      apiDurationMs: true,
      api_duration_ms: true,
      ttftMs: true,
      ttft_ms: true,
      time_to_first_token_ms: true,
    },
  },
  usageMarkers: ['"usage"', '"api-request-shape"', '"type":"user"', '"type": "user"'],
  parseLine: (line, state) => parseClaudeLine(line, state),
  parseProjected: (projected, state) => parseClaudeRecord(projected, state),
  state: { initial: initialClaudeScanState, schema: ClaudeScanState },
};

export const claudeUsageReader: ProviderUsageReader<ClaudeSettings, Path.Path> = {
  kind: "transcripts",
  provider: "claude",
  format: claudeUsageFormat,
  directories: Effect.fn("claudeUsageReader.directories")(function* ({ config, environment }) {
    if (config === undefined) return [];
    const path = yield* Path.Path;
    const homeDirectory = yield* HostProcess.HomeDirectory;
    const configured = config.homePath.trim();
    const home = configured
      ? expandHomePath(configured, homeDirectory)
      : environment.CLAUDE_CONFIG_DIR?.trim() || path.join(homeDirectory, ".claude");
    return [{ dir: path.resolve(home, "projects") }];
  }),
};
