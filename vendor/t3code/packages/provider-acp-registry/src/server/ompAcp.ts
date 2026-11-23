import {
  type OrchestrationV2UserInputQuestion,
  type ServerProviderUsageLimits,
  type ServerProviderUsageWindow,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import type { AcpAdapterV2Flavor } from "@t3tools/provider-acp/server/adapter";
import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import { findModelConfigOption } from "@t3tools/provider-acp/server/runtimeModel";
import { flattenSelectChoices } from "@t3tools/provider-acp/server/sessionConfig";
import {
  clampPercent,
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as EffectAcpErrors from "effect-acp/errors";

import type { AcpRegistrySettings } from "../settings.ts";

// ---------------------------------------------------------------------------
// Helpers & OMP identity detection
// Reference sources (Issue #10):
// - can1357/oh-my-pi: packages/coding-agent/src/modes/acp/{acp-agent.ts,acp-event-mapper.ts,acp-client-bridge.ts}
// - can1357/oh-my-pi: packages/ai/src/usage.ts
// - stablyai/orca:    src/main/acp/acp-dialects/omp-dialect.ts
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isOmpSettings(settings: AcpRegistrySettings): boolean {
  if (settings.source === "local") {
    const executable = settings.commandPath.split(/[\\/]/u).pop() ?? "";
    return /^omp(?:\.exe|\.cmd)?$/iu.test(executable);
  }
  const normalizedId = settings.agentId.trim().toLowerCase();
  return normalizedId === "omp" || normalizedId === "oh-my-pi";
}

function extractInternalErrorDetails(cause: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = cause;
  for (let depth = 0; depth < 8 && current != null && !seen.has(current); depth += 1) {
    seen.add(current);
    if (Cause.isCause(current)) {
      current = Cause.squash(current);
      continue;
    }
    const record = asRecord(current);
    if (!record) break;
    if (record.code === -32603) {
      const dataRecord = asRecord(record.data);
      const details = asNonEmptyString(dataRecord?.details);
      if (details !== undefined) {
        return details;
      }
      const dataText = asNonEmptyString(record.data);
      if (dataText !== undefined) {
        return dataText;
      }
    }
    current = record.cause;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 0. Existing OMP askDialog elicitation form support
// ---------------------------------------------------------------------------

const isForm = Schema.is(
  Schema.Struct({ properties: Schema.Record(Schema.String, Schema.Unknown) }),
);
const choice = Schema.Struct({
  const: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
});
const isQuestion = Schema.is(
  Schema.Struct({
    title: TrimmedNonEmptyString,
    description: Schema.optional(Schema.String),
    type: Schema.Literal("string"),
    oneOf: Schema.Array(choice),
  }),
);
const isCompanion = Schema.is(
  Schema.Struct({ type: Schema.Literal("string"), title: Schema.Literal("Other (type your own)") }),
);

/** OMP askDialog pairs qN choices with qN__other and puts the question in title. */
export const extractOmpElicitationForm: NonNullable<
  AcpAdapterV2Flavor["extractElicitationForm"]
> = (request) => {
  if (request.mode !== "form" || !isForm(request.requestedSchema)) return undefined;
  const { properties } = request.requestedSchema;
  const questions: OrchestrationV2UserInputQuestion[] = [];
  for (const [id, field] of Object.entries(properties)) {
    if (!/^q\d+$/.test(id)) continue;
    if (!isQuestion(field) || !isCompanion(properties[`${id}__other`])) return undefined;
    const choices = field.oneOf;
    if (choices.length === 0) return undefined;
    questions.push({
      id,
      header: field.description?.trim() || `Question ${questions.length + 1}`,
      question: field.title,
      options: choices.map((option) => ({
        label: option.title,
        value: option.const,
        description: option.description?.trim() || option.title,
      })),
    });
  }
  // Do not hide unknown fields or partially reinterpret a different form.
  if (questions.length === 0 || Object.keys(properties).length !== questions.length * 2)
    return undefined;
  return {
    questions,
    respond: (answers) => {
      const content: Record<string, string> = {};
      for (const question of questions) {
        const answer = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
        if (typeof answer !== "string" || !answer.trim()) return { action: "cancel" };
        if (question.options.some((option) => option.value === answer))
          content[question.id] = answer;
        else content[`${question.id}__other`] = answer;
      }
      return { action: "accept", content };
    },
  };
};

// ---------------------------------------------------------------------------
// 1. Runtime steering & followUp queueing (`_session/steering`)
// Aligned with can1357/oh-my-pi `acp-agent.ts` (#handleSessionSteering, L1753-L1801):
// returns `{ outcome: "injected" | "promptRequired" | "failed", queue?, reason? }`.
// ---------------------------------------------------------------------------

export const OMP_STEERING_METHOD = "_session/steering" as const;

export type OmpSteeringQueueMode = "steering" | "followUp";
export type OmpSteeringOutcomeKind = "injected" | "promptRequired" | "failed";

export interface OmpSteeringResponse {
  readonly outcome: OmpSteeringOutcomeKind;
  readonly injected: boolean;
  readonly promptRequired: boolean;
  readonly reason?: string | undefined;
  readonly steerId?: string | undefined;
  readonly queue: OmpSteeringQueueMode;
}

/**
 * Checks whether OMP advertised `_meta.steering.supported === true` in the ACP
 * `initialize` response (top-level `_meta` per `acp-agent.ts:1084`, plus
 * `agentCapabilities._meta` fallback).
 */
export function supportsOmpSteering(
  initializeResult: AcpSessionRuntime.AcpSessionRuntimeStartResult["initializeResult"],
): boolean {
  const rootMeta = asRecord((initializeResult as { readonly _meta?: unknown })._meta);
  const rootSteering = asRecord(rootMeta?.steering);
  if (rootSteering?.supported === true) {
    return true;
  }
  const capsMeta = asRecord(
    (initializeResult.agentCapabilities as { readonly _meta?: unknown } | undefined)?._meta,
  );
  const capsSteering = asRecord(capsMeta?.steering);
  return capsSteering?.supported === true;
}

export function parseOmpSteeringResponse(
  raw: unknown,
  fallbackQueue: OmpSteeringQueueMode = "steering",
): OmpSteeringResponse {
  const record = asRecord(raw);
  if (!record) {
    return { outcome: "promptRequired", injected: false, promptRequired: true, queue: fallbackQueue };
  }
  const queue: OmpSteeringQueueMode =
    record.queue === "followUp" || record.queue === "steering" ? record.queue : fallbackQueue;
  const steerId = asNonEmptyString(record.steerId) ?? asNonEmptyString(record.id);

  // Canonical oh-my-pi response: `{ outcome: "injected" | "promptRequired" | "failed", queue, reason? }`
  if (record.outcome === "injected") {
    return {
      outcome: "injected",
      injected: true,
      promptRequired: false,
      ...(steerId === undefined ? {} : { steerId }),
      queue,
    };
  }
  if (record.outcome === "promptRequired") {
    return {
      outcome: "promptRequired",
      injected: false,
      promptRequired: true,
      ...(steerId === undefined ? {} : { steerId }),
      queue,
    };
  }
  if (record.outcome === "failed") {
    const reason = asNonEmptyString(record.reason) ?? "OMP rejected _session/steering.";
    return {
      outcome: "failed",
      injected: false,
      promptRequired: false,
      reason,
      queue,
    };
  }

  // Compatibility fallback for boolean `{ injected, promptRequired }` shapes.
  const explicitInjected = typeof record.injected === "boolean" ? record.injected : undefined;
  const explicitPromptRequired =
    typeof record.promptRequired === "boolean" ? record.promptRequired : undefined;
  const injected =
    explicitInjected ?? (explicitPromptRequired === true ? false : record.accepted === true);
  const promptRequired = explicitPromptRequired ?? !injected;
  return {
    outcome: injected && !promptRequired ? "injected" : "promptRequired",
    injected,
    promptRequired,
    ...(steerId === undefined ? {} : { steerId }),
    queue,
  };
}

export type OmpSteeringRuntime = Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "request">;

export function sendOmpSteering(
  runtime: OmpSteeringRuntime,
  input: {
    readonly sessionId: string;
    readonly text: string;
    readonly images?: ReadonlyArray<EffectAcpSchema.ContentBlock>;
    readonly queue?: OmpSteeringQueueMode;
  },
): Effect.Effect<OmpSteeringResponse, EffectAcpErrors.AcpError> {
  const queue: OmpSteeringQueueMode = input.queue ?? "steering";
  const prompt: ReadonlyArray<EffectAcpSchema.ContentBlock> = [
    { type: "text", text: input.text },
    ...(input.images ?? []),
  ];
  const payload: Record<string, unknown> = {
    sessionId: input.sessionId,
    prompt,
    _meta: {
      steering: {
        queue,
      },
    },
  };
  return runtime.request(OMP_STEERING_METHOD, payload).pipe(
    Effect.flatMap((raw) => {
      const parsed = parseOmpSteeringResponse(raw, queue);
      if (parsed.outcome === "failed") {
        return Effect.fail(
          EffectAcpErrors.AcpRequestError.internalError(
            parsed.reason ?? "OMP failed to admit steering message.",
          ),
        );
      }
      return Effect.succeed(parsed);
    }),
  );
}

/**
 * Dispatches an OMP steering or follow-up message through `_session/steering` and
 * strictly honors `injected` / `promptRequired` to decide whether the host must
 * issue `session/prompt`.
 */
export function dispatchOmpSteeringOrPrompt(
  runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "request" | "prompt">,
  input: {
    readonly sessionId: string;
    readonly text: string;
    readonly images?: ReadonlyArray<EffectAcpSchema.ContentBlock>;
    readonly queue?: OmpSteeringQueueMode;
  },
): Effect.Effect<
  | {
      readonly mode: "steered";
      readonly response: OmpSteeringResponse;
    }
  | {
      readonly mode: "prompted";
      readonly response: OmpSteeringResponse;
      readonly promptResult: EffectAcpSchema.PromptResponse;
    },
  EffectAcpErrors.AcpError
> {
  return Effect.gen(function* () {
    const response = yield* sendOmpSteering(runtime, input);
    if (response.injected && !response.promptRequired) {
      return { mode: "steered" as const, response };
    }
    const promptResult = yield* runtime.prompt({
      prompt: [{ type: "text", text: input.text }, ...(input.images ?? [])],
    });
    return { mode: "prompted" as const, response, promptResult };
  });
}

export function createOmpSteering(): NonNullable<AcpAdapterV2Flavor["steering"]> {
  return {
    supported: supportsOmpSteering,
    send: (runtime, sessionId, text, images, options) =>
      sendOmpSteering(runtime, {
        sessionId,
        text,
        images,
        ...(options?.queue === undefined ? {} : { queue: options.queue }),
      }).pipe(
        Effect.map((result) => ({
          injected: result.injected,
          promptRequired: result.promptRequired,
          ...(result.steerId === undefined ? {} : { steerId: result.steerId }),
        })),
      ),
  };
}

// ---------------------------------------------------------------------------
// 2. Pure ACP compliant usage limits (`_omp/usage`)
// Aligned with can1357/oh-my-pi `acp-agent.ts:1689-1697` and `packages/ai/src/usage.ts`
// (`UsageReport` / `UsageLimit` / `UsageAmount` / `UsageWindow` / `UsageScope`).
// ---------------------------------------------------------------------------

export const OMP_USAGE_METHOD = "_omp/usage" as const;

function normalizeUsageIsoTimestamp(value: unknown): string | undefined {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? DateTime.formatIso(DateTime.makeUnsafe(parsed)) : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // Values below 10^11 are Unix seconds; larger values are milliseconds (UsageWindow.resetsAt).
    const ms = value < 1e11 ? value * 1_000 : value;
    return DateTime.formatIso(DateTime.makeUnsafe(ms));
  }
  return undefined;
}

function resolveUsageWindowDurationMins(
  record: Record<string, unknown>,
  nestedWindow?: Record<string, unknown>,
): number | undefined {
  const source = nestedWindow ?? record;
  const directMins =
    asFiniteNumber(source.windowDurationMins) ??
    asFiniteNumber(source.windowMinutes) ??
    asFiniteNumber(source.durationMinutes) ??
    asFiniteNumber(record.windowDurationMins) ??
    asFiniteNumber(record.windowMinutes);
  if (directMins !== undefined && directMins > 0) {
    return Math.round(directMins);
  }
  const durationSeconds =
    asFiniteNumber(source.windowDurationSeconds) ??
    asFiniteNumber(source.durationSeconds) ??
    asFiniteNumber(record.durationSeconds);
  if (durationSeconds !== undefined && durationSeconds > 0) {
    return Math.max(1, Math.round(durationSeconds / 60));
  }
  const durationMs =
    asFiniteNumber(source.durationMs) ??
    asFiniteNumber(source.windowDurationMs) ??
    asFiniteNumber(record.durationMs);
  if (durationMs !== undefined && durationMs > 0) {
    return Math.max(1, Math.round(durationMs / 60_000));
  }
  return undefined;
}

function resolveUsageWindowKind(
  record: Record<string, unknown>,
  nestedWindow: Record<string, unknown> | undefined,
  label: string,
  durationMins: number | undefined,
): ServerProviderUsageWindow["kind"] {
  const explicit = asNonEmptyString(record.kind)?.toLowerCase();
  if (
    explicit === "session" ||
    explicit === "weekly" ||
    explicit === "monthly" ||
    explicit === "other"
  ) {
    return explicit;
  }
  const fingerprint = [
    asNonEmptyString(nestedWindow?.id) ?? "",
    asNonEmptyString(nestedWindow?.label) ?? "",
    asNonEmptyString(record.id) ?? "",
    asNonEmptyString(record.period) ?? "",
    label,
  ]
    .join(" ")
    .toLowerCase();
  if (/\b(?:week|weekly|7d|7\s*day)\b/u.test(fingerprint)) return "weekly";
  if (/\b(?:month|monthly|30d|30\s*day)\b/u.test(fingerprint)) return "monthly";
  if (/\b(?:session|5h|5\s*hour|hour|hourly|daily|24h|rolling|primary|burst)\b/u.test(fingerprint)) {
    return "session";
  }
  if (durationMins !== undefined) {
    if (durationMins <= 24 * 60) return "session";
    if (durationMins <= 8 * 24 * 60) return "weekly";
    if (durationMins <= 32 * 24 * 60) return "monthly";
  }
  return "other";
}

/**
 * Mirrors oh-my-pi `resolveUsedFraction` precedence (packages/ai/src/usage.ts:171-180):
 * explicit fraction > used/limit > percent-unit used > inverted remaining,
 * plus flat percentage aliases for non-nested entries.
 */
function resolveUsedPercent(record: Record<string, unknown>): number | undefined {
  const amount = asRecord(record.amount);
  if (amount !== undefined) {
    const usedFraction = asFiniteNumber(amount.usedFraction);
    if (usedFraction !== undefined) {
      return clampPercent(usedFraction * 100);
    }
    const used = asFiniteNumber(amount.used);
    const limit = asFiniteNumber(amount.limit);
    if (used !== undefined && limit !== undefined && limit > 0) {
      return clampPercent((used / limit) * 100);
    }
    if (amount.unit === "percent" && used !== undefined) {
      return clampPercent(used);
    }
    const remainingFraction = asFiniteNumber(amount.remainingFraction);
    if (remainingFraction !== undefined) {
      return clampPercent(Math.max(0, 1 - remainingFraction) * 100);
    }
    const remaining = asFiniteNumber(amount.remaining);
    if (remaining !== undefined && limit !== undefined && limit > 0) {
      return clampPercent(((limit - remaining) / limit) * 100);
    }
  }

  const direct =
    asFiniteNumber(record.usedPercent) ??
    asFiniteNumber(record.percentUsed) ??
    asFiniteNumber(record.used_percent);
  if (direct !== undefined) {
    return clampPercent(direct);
  }
  const ratio =
    asFiniteNumber(record.usedFraction) ??
    asFiniteNumber(record.utilization) ??
    asFiniteNumber(record.usageRatio);
  if (ratio !== undefined) {
    return clampPercent(ratio <= 1 ? ratio * 100 : ratio);
  }
  const remainingFraction = asFiniteNumber(record.remainingFraction);
  if (remainingFraction !== undefined) {
    return clampPercent(Math.max(0, 1 - remainingFraction) * 100);
  }
  const remaining =
    asFiniteNumber(record.remainingPercent) ?? asFiniteNumber(record.remaining_percent);
  if (remaining !== undefined) {
    return clampPercent(100 - remaining);
  }
  const used = asFiniteNumber(record.used);
  const limit = asFiniteNumber(record.limit) ?? asFiniteNumber(record.total);
  if (used !== undefined && limit !== undefined && limit > 0) {
    return clampPercent((used / limit) * 100);
  }
  return undefined;
}

function extractStringArray(value: unknown): ReadonlyArray<string> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((entry) => asNonEmptyString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return items.length > 0 ? items : undefined;
}

/**
 * Maps pure ACP `_omp/usage` aggregated `reports` payload into `ServerProviderUsageLimits`.
 * Strictly operates on the ACP RPC payload — never reads local CLI credential directories or external vendor APIs.
 */
export function mapOmpUsageReportsToLimits(
  raw: unknown,
  checkedAt: string,
): ServerProviderUsageLimits {
  const root = asRecord(raw);
  const nestedData = asRecord(root?.data);
  const reportsRaw = Array.isArray(raw)
    ? raw
    : Array.isArray(root?.reports)
      ? root.reports
      : Array.isArray(nestedData?.reports)
        ? nestedData.reports
        : undefined;

  if (reportsRaw === undefined) {
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "probeFailed",
      message: "OMP _omp/usage response did not include a reports array.",
    });
  }

  const windows: Array<ServerProviderUsageWindow> = [];
  const seenIds = new Set<string>();

  for (const [reportIndex, entry] of reportsRaw.entries()) {
    const report = asRecord(entry);
    if (!report) continue;
    const reportProviderId =
      asNonEmptyString(report.provider) ??
      asNonEmptyString(report.providerId) ??
      asNonEmptyString(report.id) ??
      `omp-${reportIndex + 1}`;
    const providerLabel =
      asNonEmptyString(report.displayName) ?? asNonEmptyString(report.name) ?? reportProviderId;
    const reportModelIds = extractStringArray(report.modelIds ?? report.models);
    const reportProviderIds = extractStringArray(report.providerIds) ?? [reportProviderId];

    // Canonical oh-my-pi UsageReport uses `limits: UsageLimit[]`; also accept `windows`.
    const rawEntries = Array.isArray(report.limits)
      ? report.limits
      : Array.isArray(report.windows)
        ? report.windows
        : [report];

    for (const [entryIndex, rawEntry] of rawEntries.entries()) {
      const limitRecord = asRecord(rawEntry);
      if (!limitRecord) continue;
      const usedPercent = resolveUsedPercent(limitRecord);
      if (usedPercent === undefined) continue;

      const scopeRecord = asRecord(limitRecord.scope);
      const windowRecord = asRecord(limitRecord.window);
      const effectiveProviderId = asNonEmptyString(scopeRecord?.provider) ?? reportProviderId;
      const rawId =
        asNonEmptyString(limitRecord.id) ??
        asNonEmptyString(windowRecord?.id) ??
        asNonEmptyString(scopeRecord?.windowId) ??
        asNonEmptyString(limitRecord.windowId) ??
        asNonEmptyString(limitRecord.period) ??
        `window-${entryIndex + 1}`;
      const baseId = rawId.startsWith(`${effectiveProviderId}:`)
        ? rawId
        : `${effectiveProviderId}:${rawId}`;
      let uniqueId = baseId;
      let suffix = 2;
      while (seenIds.has(uniqueId)) {
        uniqueId = `${baseId}-${suffix}`;
        suffix += 1;
      }
      seenIds.add(uniqueId);

      const entryLabel =
        asNonEmptyString(limitRecord.label) ??
        asNonEmptyString(windowRecord?.label) ??
        asNonEmptyString(limitRecord.name) ??
        asNonEmptyString(limitRecord.period) ??
        providerLabel;
      const label =
        entryLabel.toLowerCase().includes(providerLabel.toLowerCase()) ||
        providerLabel === effectiveProviderId
          ? entryLabel
          : `${providerLabel} · ${entryLabel}`;
      const windowDurationMins = resolveUsageWindowDurationMins(limitRecord, windowRecord);
      const kind = resolveUsageWindowKind(limitRecord, windowRecord, label, windowDurationMins);
      const resetsAt = normalizeUsageIsoTimestamp(
        windowRecord?.resetsAt ??
          limitRecord.resetsAt ??
          limitRecord.resetAt ??
          limitRecord.resets_at,
      );
      const scopeModelId = asNonEmptyString(scopeRecord?.modelId);
      const modelIds =
        extractStringArray(limitRecord.modelIds) ??
        (scopeModelId ? [scopeModelId] : undefined) ??
        reportModelIds;
      const providerIds =
        effectiveProviderId === reportProviderId ? reportProviderIds : [effectiveProviderId];

      windows.push({
        id: uniqueId,
        kind,
        label,
        usedPercent,
        providerIds,
        ...(modelIds === undefined ? {} : { modelIds }),
        ...(resetsAt === undefined ? {} : { resetsAt }),
        ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
      });
    }
  }

  return makeUsageLimits({ checkedAt, windows });
}

/**
 * Fetches OMP usage limits purely via ACP `extRequest("_omp/usage", {})`.
 * Never accesses local CLI credential directories or contacts third-party provider endpoints directly.
 */
export function fetchOmpUsageLimits(
  runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "request">,
  checkedAt: string,
): Effect.Effect<ServerProviderUsageLimits> {
  return runtime.request(OMP_USAGE_METHOD, {}).pipe(
    Effect.map((response) => mapOmpUsageReportsToLimits(response, checkedAt)),
    Effect.catch((error) => {
      const isMethodNotFound = error._tag === "AcpRequestError" && error.code === -32601;
      return Effect.succeed(
        makeUnavailableUsageLimits({
          checkedAt,
          reason: isMethodNotFound ? "unsupported" : "probeFailed",
          message: isMethodNotFound
            ? "This OMP ACP runtime does not expose _omp/usage."
            : error.message,
        }),
      );
    }),
  );
}

// ---------------------------------------------------------------------------
// 3. Shell tool output cleaning & exit code normalization
// Aligned with stablyai/orca `omp-dialect.ts` (L13-L94) and
// can1357/oh-my-pi `acp-event-mapper.ts` (L346, L388, L849).
// ---------------------------------------------------------------------------

const SHELL_TOOL_NAME_PATTERN =
  /^(?:bash|sh|zsh|fish|shell|cmd|powershell|pwsh|terminal|exec|execute|run_command)$/iu;

const TRAILING_WALL_TIME_PATTERN =
  /(?:\n\n|\n|^)Wall time:\s*([0-9]+(?:\.[0-9]+)?)\s*(?:seconds|s)[ \t]*$/iu;
const TRAILING_EXIT_CODE_PATTERN = /(?:\n\n|\n|^)Command exited with code\s+(-?\d+)[ \t]*$/iu;
const LEADING_ECHO_COMMAND_PATTERN = /^\$ ([^\n]+)(?:\n\n|\n|$)/;

const PRE_NORMALIZED_OUTPUT_KEYS = [
  "exitCode",
  "exit_code",
  "stdout",
  "stderr",
  "output_for_prompt",
] as const;

export interface CleanedOmpShellOutput {
  readonly stdout: string;
  readonly exitCode?: number | undefined;
  readonly wallTimeSeconds?: number | undefined;
  readonly strippedEchoCommand?: string | undefined;
  readonly changed: boolean;
}

function extractCommandFromToolFields(input: {
  readonly rawInput?: unknown;
  readonly title?: string | null | undefined;
}): string | undefined {
  const rawInput = asRecord(input.rawInput);
  const direct =
    asNonEmptyString(rawInput?.command) ??
    asNonEmptyString(rawInput?.cmd) ??
    asNonEmptyString(rawInput?.script);
  if (direct !== undefined) return direct;
  const title = asNonEmptyString(input.title);
  if (title?.startsWith("$ ")) {
    return title.slice(2).trim() || undefined;
  }
  return undefined;
}

function isAsyncRawInput(rawInput: unknown): boolean {
  return asRecord(rawInput)?.async === true;
}

function looksLikeShellToolUpdate(input: {
  readonly kind?: string | null | undefined;
  readonly name?: string | null | undefined;
  readonly title?: string | null | undefined;
  readonly rawInput?: unknown;
  readonly text?: string | undefined;
}): boolean {
  if (input.kind === "execute") return true;
  const name = asNonEmptyString(input.name);
  if (name && SHELL_TOOL_NAME_PATTERN.test(name)) return true;
  const title = asNonEmptyString(input.title);
  if (title && (title.startsWith("$ ") || SHELL_TOOL_NAME_PATTERN.test(title))) return true;
  const rawInput = asRecord(input.rawInput);
  if (
    asNonEmptyString(rawInput?.command) !== undefined ||
    asNonEmptyString(rawInput?.cmd) !== undefined
  ) {
    return true;
  }
  if (input.text !== undefined) {
    const normalized = input.text.replace(/\r\n/gu, "\n");
    if (
      normalized.startsWith("$ ") ||
      TRAILING_EXIT_CODE_PATTERN.test(normalized) ||
      TRAILING_WALL_TIME_PATTERN.test(normalized)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Strips duplicated leading `$ <cmd>` echo and trailing `\n\nCommand exited with code N`
 * and `\n\nWall time: X seconds` / `Xs` footers produced by OMP's shell tool.
 */
export function cleanOmpShellOutput(
  rawText: string,
  expectedCommand?: string,
  options?: { readonly knownExitCode?: number | undefined; readonly timed?: boolean | undefined },
): CleanedOmpShellOutput {
  let working = rawText.replace(/\r\n/gu, "\n");
  let exitCode: number | undefined = options?.knownExitCode;
  let wallTimeSeconds: number | undefined;
  let strippedEchoCommand: string | undefined;
  let changed = false;

  // Strip trailing footers in any order (exit code then wall time, or vice versa).
  for (let pass = 0; pass < 4; pass += 1) {
    const exitMatch = TRAILING_EXIT_CODE_PATTERN.exec(working);
    if (exitMatch !== null) {
      const parsed = Number.parseInt(exitMatch[1] ?? "", 10);
      if (Number.isSafeInteger(parsed)) {
        exitCode = parsed;
      }
      working = working.slice(0, exitMatch.index);
      changed = true;
      continue;
    }
    const wallMatch = TRAILING_WALL_TIME_PATTERN.exec(working);
    if (wallMatch !== null && options?.timed !== false) {
      const parsed = Number.parseFloat(wallMatch[1] ?? "");
      if (Number.isFinite(parsed)) {
        wallTimeSeconds = parsed;
      }
      working = working.slice(0, wallMatch.index);
      changed = true;
      continue;
    }
    break;
  }

  // Strip duplicated `$ <cmd>` echo prefix.
  const echoMatch = LEADING_ECHO_COMMAND_PATTERN.exec(working);
  if (echoMatch !== null) {
    const echoed = (echoMatch[1] ?? "").trim();
    const expectedFirstLine = expectedCommand?.replace(/\r\n/gu, "\n").split("\n", 1)[0]?.trim();
    const matchesExpected =
      expectedFirstLine === undefined ||
      expectedFirstLine.length === 0 ||
      echoed === expectedFirstLine ||
      echoed.startsWith(expectedFirstLine) ||
      expectedFirstLine.startsWith(echoed);
    if (matchesExpected) {
      strippedEchoCommand = echoed;
      working = working.slice(echoMatch[0].length);
      changed = true;
    }
  }

  return {
    stdout: working,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(wallTimeSeconds === undefined ? {} : { wallTimeSeconds }),
    ...(strippedEchoCommand === undefined ? {} : { strippedEchoCommand }),
    changed,
  };
}

function textFromToolCallContentEntry(entry: EffectAcpSchema.ToolCallContent): string | undefined {
  if (entry.type === "content" && entry.content.type === "text") {
    return entry.content.text;
  }
  return undefined;
}

interface ParsedOmpAgentToolResult {
  readonly raw: Record<string, unknown>;
  readonly texts: ReadonlyArray<string>;
  readonly details?: {
    readonly exitCode?: number | undefined;
    readonly wallTimeMs?: number | undefined;
    readonly timedOut?: unknown;
    readonly signal?: unknown;
    readonly async?: unknown;
    readonly service?: unknown;
  };
}

function parseOmpAgentToolResult(rawOutput: unknown): ParsedOmpAgentToolResult | undefined {
  const raw = asRecord(rawOutput);
  if (!raw || !Array.isArray(raw.content)) return undefined;
  const texts: Array<string> = [];
  for (const block of raw.content) {
    const record = asRecord(block);
    if (record?.type === "text" && typeof record.text === "string") {
      texts.push(record.text);
    }
  }
  const detailsRecord = asRecord(raw.details);
  const exitCodeRaw = detailsRecord?.exitCode;
  const exitCode =
    typeof exitCodeRaw === "number" && Number.isSafeInteger(exitCodeRaw) ? exitCodeRaw : undefined;
  const wallTimeMsRaw = detailsRecord?.wallTimeMs;
  const wallTimeMs =
    typeof wallTimeMsRaw === "number" && Number.isFinite(wallTimeMsRaw) && wallTimeMsRaw >= 0
      ? wallTimeMsRaw
      : undefined;

  return {
    raw,
    texts,
    ...(detailsRecord === undefined
      ? {}
      : {
          details: {
            ...(exitCode === undefined ? {} : { exitCode }),
            ...(wallTimeMs === undefined ? {} : { wallTimeMs }),
            ...(Object.hasOwn(detailsRecord, "timedOut") ? { timedOut: detailsRecord.timedOut } : {}),
            ...(Object.hasOwn(detailsRecord, "signal") ? { signal: detailsRecord.signal } : {}),
            ...(Object.hasOwn(detailsRecord, "async") ? { async: detailsRecord.async } : {}),
            ...(Object.hasOwn(detailsRecord, "service") ? { service: detailsRecord.service } : {}),
          },
        }),
  };
}

export interface OmpToolNormalizationContext {
  readonly command?: string | undefined;
  readonly isShell?: boolean | undefined;
  readonly isAsync?: boolean | undefined;
}

/**
 * Normalizes OMP `tool_call` / `tool_call_update` notifications:
 * 1. Canonical OMP wire shape (`stablyai/orca` `omp-dialect.ts`):
 *    When `content[0]` is a `$ <cmd>` echo and `rawOutput` is OMP's `{ content, details }`
 *    `AgentToolResult`, removes the repeated echo and duplicate result text from `content`
 *    (preserving non-output blocks), strips exit/wall-time footers, and writes clean `stdout`
 *    and foreground-verified integer `exitCode` into `rawOutput`.
 * 2. Fallback inline-text shape:
 *    When `rawOutput` is absent, strips leading `$ <cmd>` echo and trailing exit/wall-time
 *    footers directly from `content`, writing clean `stdout` and integer `exitCode` into `rawOutput`.
 */
export function normalizeOmpToolUpdate(
  notification: EffectAcpSchema.SessionNotification,
  context?: OmpToolNormalizationContext,
): EffectAcpSchema.SessionNotification {
  const update = notification.update;
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update") {
    return notification;
  }

  const content = update.content;
  if (!Array.isArray(content) || content.length === 0) {
    return notification;
  }

  const existingRawOutput = asRecord(update.rawOutput);
  if (
    existingRawOutput !== undefined &&
    (PRE_NORMALIZED_OUTPUT_KEYS.some((key) => existingRawOutput[key] !== undefined) ||
      existingRawOutput.signal != null ||
      existingRawOutput.timed_out === true)
  ) {
    return notification;
  }

  const firstEntryText = textFromToolCallContentEntry(content[0]!);
  const parsedToolResult = parseOmpAgentToolResult(update.rawOutput);

  // Path 1: Canonical OMP wire shape (`content[0]` = "$ <cmd>" echo, `rawOutput` = `{ content, details }`).
  if (firstEntryText?.startsWith("$ ") && !firstEntryText.includes("\n")) {
    if (parsedToolResult !== undefined) {
      if (parsedToolResult.texts.includes(firstEntryText)) {
        return notification;
      }
      const remainingContent = content.slice(1).filter((block) => {
        const text = textFromToolCallContentEntry(block);
        return text === undefined || !parsedToolResult.texts.includes(text);
      });
      const details = parsedToolResult.details;
      const cleaned = cleanOmpShellOutput(parsedToolResult.texts.join("\n"), undefined, {
        knownExitCode: details?.exitCode,
        timed: details?.wallTimeMs !== undefined,
      });
      // Only timed foreground completion implies exit zero; service/background/signaled launches prove no exit.
      const isForegroundCompleted =
        update.status === "completed" &&
        details?.wallTimeMs !== undefined &&
        details.timedOut !== true &&
        (details.signal === undefined || details.signal === null) &&
        details.async === undefined &&
        details.service === undefined &&
        !isAsyncRawInput(update.rawInput) &&
        context?.isAsync !== true;
      const exitCode = cleaned.exitCode ?? (isForegroundCompleted ? 0 : undefined);

      return {
        ...notification,
        update: {
          ...update,
          content: remainingContent,
          rawOutput: {
            ...parsedToolResult.raw,
            stdout: cleaned.stdout,
            ...(exitCode === undefined ? {} : { exitCode }),
          },
        },
      };
    }

    // Echo-only in-progress update without rawOutput yet: drop redundant `$ <cmd>` echo block.
    if (content.length === 1) {
      return {
        ...notification,
        update: {
          ...update,
          content: [],
        },
      };
    }
  }

  // Path 2: Flattened / inline shell text blocks (e.g. `$ <cmd>\n...\n\nCommand exited with code N\n\nWall time: Xs`).
  const command =
    extractCommandFromToolFields({
      rawInput: update.rawInput,
      title: update.title,
    }) ?? context?.command;

  const firstText = content.map(textFromToolCallContentEntry).find((value) => value !== undefined);
  const isShell =
    context?.isShell === true ||
    looksLikeShellToolUpdate({
      kind: update.kind,
      name: "name" in update ? (update.name as string | null | undefined) : undefined,
      title: update.title,
      rawInput: update.rawInput,
      text: firstText,
    });

  if (!isShell) {
    return notification;
  }

  let anyChanged = false;
  let parsedExitCode: number | undefined;
  let parsedWallTimeSeconds: number | undefined;
  const stdoutSegments: Array<string> = [];

  const nextContent = content.map((entry) => {
    const text = textFromToolCallContentEntry(entry);
    if (text === undefined) return entry;
    const cleaned = cleanOmpShellOutput(text, command);
    stdoutSegments.push(cleaned.stdout);
    if (cleaned.exitCode !== undefined) {
      parsedExitCode = cleaned.exitCode;
    }
    if (cleaned.wallTimeSeconds !== undefined) {
      parsedWallTimeSeconds = cleaned.wallTimeSeconds;
    }
    if (cleaned.changed) {
      anyChanged = true;
      return {
        type: "content" as const,
        content: {
          type: "text" as const,
          text: cleaned.stdout,
        },
      };
    }
    return entry;
  });

  if (!anyChanged && parsedExitCode === undefined && parsedWallTimeSeconds === undefined) {
    return notification;
  }

  const stdout = stdoutSegments.join("\n");
  const isAsync = isAsyncRawInput(update.rawInput) || context?.isAsync === true;
  // Infer exitCode 0 only when timed foreground completion is evidenced (wall time present & not async).
  const resolvedExitCode =
    parsedExitCode ??
    (update.status === "completed" && parsedWallTimeSeconds !== undefined && !isAsync
      ? 0
      : undefined);

  const nextRawOutput: Record<string, unknown> = {
    ...(existingRawOutput ?? {}),
    stdout,
    ...(resolvedExitCode === undefined ? {} : { exitCode: resolvedExitCode }),
    ...(parsedWallTimeSeconds === undefined ? {} : { wallTimeSeconds: parsedWallTimeSeconds }),
  };

  return {
    ...notification,
    update: {
      ...update,
      content: nextContent,
      rawOutput: nextRawOutput,
    },
  };
}

/**
 * Creates a stateful session-update normalizer for a live OMP ACP session so
 * `tool_call_update` frames that omit `kind`/`rawInput` still inherit shell & async
 * context from the initial `tool_call`.
 */
export function createOmpSessionUpdateNormalizer(): (
  notification: EffectAcpSchema.SessionNotification,
) => EffectAcpSchema.SessionNotification {
  const rememberedTools = new Map<string, OmpToolNormalizationContext>();
  return (notification) => {
    const update = notification.update;
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      const prior = rememberedTools.get(update.toolCallId);
      const command =
        extractCommandFromToolFields({
          rawInput: update.rawInput,
          title: update.title,
        }) ?? prior?.command;
      const isShell =
        prior?.isShell === true ||
        looksLikeShellToolUpdate({
          kind: update.kind,
          name: "name" in update ? (update.name as string | null | undefined) : undefined,
          title: update.title,
          rawInput: update.rawInput,
        });
      const isAsync = prior?.isAsync === true || isAsyncRawInput(update.rawInput);
      const nextContext: OmpToolNormalizationContext = { command, isShell, isAsync };
      rememberedTools.set(update.toolCallId, nextContext);
      if (update.status === "completed" || update.status === "failed") {
        rememberedTools.delete(update.toolCallId);
      }
      return normalizeOmpToolUpdate(notification, nextContext);
    }
    return notification;
  };
}

// ---------------------------------------------------------------------------
// 4A. Missing API key auth classification, session-lost & compaction replies
// Aligned with stablyai/orca `omp-dialect.ts` (L10-L12, L96-L108, L126-L164).
// ---------------------------------------------------------------------------

export const OMP_MISSING_API_KEY_PREFIX = "No API key found for ";
export const OMP_UNKNOWN_MODEL_PREFIX = "Unknown ACP model: ";
export const OMP_NO_MODEL_SELECTED_PREFIX = "No model selected.";
export const OMP_CANCEL_CLEANUP_TIMED_OUT = "ACP cancel cleanup timed out";
export const OMP_UNSUPPORTED_SESSION_PREFIX = "Unsupported ACP session: ";

export function extractOmpMissingApiKeyDetails(cause: unknown): string | undefined {
  const details = extractInternalErrorDetails(cause);
  if (details !== undefined && details.startsWith(OMP_MISSING_API_KEY_PREFIX)) {
    return details;
  }
  return undefined;
}

/**
 * Pi/OMP prompt failure when the active model has no configured API key (`-32603` +
 * `data.details` starting with `"No API key found for "`).
 * Explicitly does NOT treat `"No model selected."` as signed-out (`omp-dialect.ts:10`).
 */
export function reportsNoApiKey(cause: unknown): boolean {
  return extractOmpMissingApiKeyDetails(cause) !== undefined;
}

export const isOmpMissingApiKeyError = reportsNoApiKey;

export function isOmpUnknownModelOptionError(cause: unknown): boolean {
  return extractInternalErrorDetails(cause)?.startsWith(OMP_UNKNOWN_MODEL_PREFIX) === true;
}

export function isOmpNoModelSelectedError(cause: unknown): boolean {
  return extractInternalErrorDetails(cause)?.startsWith(OMP_NO_MODEL_SELECTED_PREFIX) === true;
}

/**
 * A timed-out cancel cleanup closes the OMP session; subsequent prompts fail with
 * `"ACP cancel cleanup timed out"` or `"Unsupported ACP session: <id>"` (`omp-dialect.ts:159`).
 */
export function isOmpLostSessionError(cause: unknown, sessionId?: string): boolean {
  const details = extractInternalErrorDetails(cause);
  if (details === undefined) return false;
  if (details === OMP_CANCEL_CLEANUP_TIMED_OUT) return true;
  if (sessionId !== undefined) {
    return details === `${OMP_UNSUPPORTED_SESSION_PREFIX}${sessionId}`;
  }
  return details.startsWith(OMP_UNSUPPORTED_SESSION_PREFIX);
}

export function formatOmpMissingApiKeyGuidance(
  details: string,
  terminalAuthCommand?: string,
): string {
  const normalizedDetails = details.trim().replace(/\.+$/u, "");
  const terminalHint = terminalAuthCommand
    ? `Complete authentication using OMP native terminal auth (\`${terminalAuthCommand}\`) or click Sign in in Provider Settings.`
    : "Complete authentication using OMP native terminal auth (Sign in from Provider Settings) to configure your API key.";
  return `${normalizedDetails}. ${terminalHint}`;
}

export interface OmpCompactionReply {
  readonly outcome: "skipped" | "failed";
  readonly detail: string;
}

const OMP_COMPACTION_FAILED_PATTERN = /\bcompaction failed\b|\bdoes not take focus instructions\b/iu;
const OMP_COMPACTION_NOOP_PATTERN = /\b(?:nothing to compact|already compacted)\b/iu;

/**
 * OMP reports compaction failures, no-ops, and refused focus arguments inside a
 * normally completed `/compact` turn's reply (`omp-dialect.ts:96-108`).
 * Returns `undefined` when compaction succeeded.
 */
export function parseOmpCompactionReply(text: string): OmpCompactionReply | undefined {
  const reply = text.trim();
  if (!OMP_COMPACTION_FAILED_PATTERN.test(reply)) {
    return undefined;
  }
  return OMP_COMPACTION_NOOP_PATTERN.test(reply)
    ? { outcome: "skipped", detail: reply.replace(/^compaction failed:\s*/iu, "") }
    : { outcome: "failed", detail: reply };
}

// ---------------------------------------------------------------------------
// 4B. `/model <selector>` role selector & reply parsing
// Aligned with stablyai/orca `omp-dialect.ts` (L110-L156):
// - OMP 18.1.8's `/model` matches IDs; 18.1.9+ resolves role selectors (`smol`/`slow`/`plan`).
// - `Model set to <id>.` confirms model (and optional `:effort`) applied.
// - Refusals distinguish `notSignedIn` (`/\bNo API key\b/`) vs `modelUnavailable`.
// ---------------------------------------------------------------------------

export const OMP_MODEL_SELECTOR_MIN_VERSION = "18.1.9" as const;

export const OMP_MODEL_ROLE_SELECTORS = [
  "smol",
  "slow",
  "plan",
  "fast",
  "default",
  "vision",
  "commit",
] as const;

export type OmpModelRoleSelector = (typeof OMP_MODEL_ROLE_SELECTORS)[number];

const OMP_MODEL_ROLE_SET = new Set<string>(OMP_MODEL_ROLE_SELECTORS);

export interface ParsedOmpModelCommand {
  readonly selector: string;
  readonly isRoleSelector: boolean;
}

export function isOmpModelRoleSelector(value: string): value is OmpModelRoleSelector {
  return OMP_MODEL_ROLE_SET.has(value.trim().toLowerCase());
}

export function parseOmpModelCommand(text: string): ParsedOmpModelCommand | undefined {
  const match = /^\s*\/model\s+([^\s]+)\s*$/iu.exec(text);
  const selector = match?.[1]?.trim();
  if (!selector) return undefined;
  return {
    selector,
    isRoleSelector: isOmpModelRoleSelector(selector),
  };
}

export type OmpModelSwitchRefusalReason = "notSignedIn" | "modelUnavailable";

export type OmpModelSwitchOutcome =
  | {
      readonly kind: "set";
      readonly modelId: string;
      readonly rawText: string;
    }
  | {
      readonly kind: "rejected";
      readonly refusalReason: OmpModelSwitchRefusalReason;
      readonly reason: string;
      readonly rawText: string;
    };

// `/model` says "Model set to provider/id." (or "Model set to provider/id:level.") only after applying.
const MODEL_SET_REPLY_PATTERN = /^Model set to (\S+)\.$/u;
const MODEL_NO_API_KEY_PATTERN = /\bNo API key\b/u;

export function parseOmpModelSwitchReply(text: string): OmpModelSwitchOutcome {
  const reply = text.trim();
  const applied = MODEL_SET_REPLY_PATTERN.exec(reply)?.[1];
  if (applied) {
    return {
      kind: "set",
      modelId: applied,
      rawText: reply,
    };
  }
  return {
    kind: "rejected",
    refusalReason: MODEL_NO_API_KEY_PATTERN.test(reply) ? "notSignedIn" : "modelUnavailable",
    reason: reply || "OMP refused the /model selection.",
    rawText: reply,
  };
}

export type OmpModelSwitchRuntime = Pick<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  "prompt" | "handleSessionUpdate"
>;

/**
 * Executes `/model <selector>` (e.g. `smol`, `slow`, `plan`, or explicit model id)
 * against OMP over standard ACP `session/prompt`, capturing the assistant reply text
 * and parsing `Model set to <id>.` vs refusal (`notSignedIn` | `modelUnavailable`).
 */
export function switchOmpModelViaCommand(
  runtime: OmpModelSwitchRuntime,
  selector: string,
): Effect.Effect<OmpModelSwitchOutcome, EffectAcpErrors.AcpError> {
  const normalizedSelector = selector.trim();
  if (normalizedSelector.length === 0) {
    return Effect.fail(EffectAcpErrors.AcpRequestError.invalidParams("Model selector is empty."));
  }
  return Effect.scoped(
    Effect.gen(function* () {
      const chunksRef = yield* Ref.make<Array<string>>([]);
      yield* runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (
          update.sessionUpdate === "agent_message_chunk" &&
          update.content.type === "text" &&
          update.content.text.length > 0
        ) {
          const textChunk = update.content.text;
          return Ref.update(chunksRef, (chunks) => [...chunks, textChunk]);
        }
        return Effect.void;
      });
      yield* runtime.prompt({
        prompt: [{ type: "text", text: `/model ${normalizedSelector}` }],
      });
      const replyText = (yield* Ref.get(chunksRef)).join("").trim();
      return parseOmpModelSwitchReply(replyText);
    }),
  );
}

function failFromOmpModelSwitchOutcome(
  outcome: Extract<OmpModelSwitchOutcome, { readonly kind: "rejected" }>,
): EffectAcpErrors.AcpRequestError {
  if (outcome.refusalReason === "notSignedIn") {
    return new EffectAcpErrors.AcpRequestError({
      code: -32603,
      errorMessage: outcome.reason,
      data: { details: outcome.reason },
    });
  }
  return EffectAcpErrors.AcpRequestError.invalidParams(outcome.reason);
}

function isOptionModelRefusal(error: EffectAcpErrors.AcpError): boolean {
  return (
    (error._tag === "AcpRequestError" && error.code === -32602) ||
    isOmpUnknownModelOptionError(error)
  );
}

/**
 * OMP `flavor.applyModelSelection` hook:
 * - Uses standard ACP config option / `setSessionModel` for advertised static models.
 * - Uses `/model <selector>` for OMP role selectors (`smol`, `slow`, `plan`, etc.)
 *   or when OMP `#setModelById` refuses an unlisted selector (`-32602` or `-32603`
 *   `"Unknown ACP model: "`), mapping `notSignedIn` vs `modelUnavailable` cleanly.
 */
export const applyOmpModelSelection: NonNullable<AcpAdapterV2Flavor["applyModelSelection"]> =
  Effect.fn("applyOmpModelSelection")(function* ({ runtime, startResult, modelSelection }) {
    const rawRequested = modelSelection.model.trim();
    if (rawRequested.length === 0 || rawRequested === "default" || rawRequested === "auto") {
      return undefined;
    }

    const parsedCommand = parseOmpModelCommand(rawRequested);
    const selector = parsedCommand?.selector ?? rawRequested;
    const isRole = parsedCommand?.isRoleSelector === true || isOmpModelRoleSelector(selector);

    const modelOption = findModelConfigOption(yield* runtime.getConfigOptions);
    const modelState = startResult.sessionSetupResult.models;

    const advertisedInOption =
      modelOption?.type === "select" &&
      flattenSelectChoices(modelOption.options).some((choice) => choice.value === selector);
    const advertisedInState =
      modelState?.availableModels.some((model) => model.modelId === selector) === true;

    if (!isRole && advertisedInOption && modelOption?.type === "select") {
      const result = yield* runtime
        .setConfigOption(modelOption.id, selector)
        .pipe(Effect.as(selector), Effect.result);
      if (result._tag === "Success") return result.success;
      if (!isOptionModelRefusal(result.failure)) return yield* result.failure;
    } else if (!isRole && advertisedInState && modelState != null) {
      if (modelState.currentModelId === selector) return selector;
      const result = yield* runtime
        .setSessionModel(selector)
        .pipe(Effect.as(selector), Effect.result);
      if (result._tag === "Success") return result.success;
      if (!isOptionModelRefusal(result.failure)) return yield* result.failure;
    } else if (!isRole && parsedCommand === undefined) {
      // Unlisted non-role model id: try standard ACP option first, fall back to `/model` on Unknown ACP model / -32602.
      if (modelOption?.type === "select") {
        const result = yield* runtime
          .setConfigOption(modelOption.id, selector)
          .pipe(Effect.as(selector), Effect.result);
        if (result._tag === "Success") return result.success;
        if (!isOptionModelRefusal(result.failure)) return yield* result.failure;
      } else if (modelState != null) {
        const result = yield* runtime
          .setSessionModel(selector)
          .pipe(Effect.as(selector), Effect.result);
        if (result._tag === "Success") return result.success;
        if (!isOptionModelRefusal(result.failure)) return yield* result.failure;
      }
    }

    const outcome = yield* switchOmpModelViaCommand(runtime, selector);
    if (outcome.kind === "set") {
      return outcome.modelId;
    }
    return yield* failFromOmpModelSwitchOutcome(outcome);
  });
