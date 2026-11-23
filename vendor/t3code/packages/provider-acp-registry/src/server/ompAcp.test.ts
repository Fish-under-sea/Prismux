import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import type * as EffectAcpSchema from "effect-acp/compat";
import * as EffectAcpErrors from "effect-acp/errors";

import { acpRegistryPromptFailure } from "./adapter.ts";
import {
  applyOmpModelSelection,
  cleanOmpShellOutput,
  createOmpSessionUpdateNormalizer,
  createOmpSteering,
  dispatchOmpSteeringOrPrompt,
  extractOmpElicitationForm,
  extractOmpMissingApiKeyDetails,
  fetchOmpUsageLimits,
  isOmpLostSessionError,
  isOmpMissingApiKeyError,
  isOmpModelRoleSelector,
  isOmpNoModelSelectedError,
  isOmpUnknownModelOptionError,
  mapOmpUsageReportsToLimits,
  normalizeOmpToolUpdate,
  OMP_CANCEL_CLEANUP_TIMED_OUT,
  OMP_MODEL_SELECTOR_MIN_VERSION,
  OMP_STEERING_METHOD,
  OMP_USAGE_METHOD,
  parseOmpCompactionReply,
  parseOmpModelCommand,
  parseOmpModelSwitchReply,
  reportsNoApiKey,
  sendOmpSteering,
  supportsOmpSteering,
  switchOmpModelViaCommand,
} from "./ompAcp.ts";
import { acpRegistryProbeFailure } from "./probe.ts";

const makeInitializeResult = (
  meta?: Record<string, unknown>,
  capabilitiesMeta?: Record<string, unknown>,
) =>
  ({
    protocolVersion: 1,
    agentInfo: { name: "omp", version: OMP_MODEL_SELECTOR_MIN_VERSION },
    agentCapabilities: {
      ...(capabilitiesMeta ? { _meta: capabilitiesMeta } : {}),
    },
    ...(meta ? { _meta: meta } : {}),
  }) as unknown as Parameters<typeof supportsOmpSteering>[0];

describe("ompAcp", () => {
  describe("1. runtime steering & followUp queueing (_session/steering)", () => {
    it("detects _meta.steering.supported === true from initialize response", () => {
      assert.isTrue(supportsOmpSteering(makeInitializeResult({ steering: { supported: true } })));
      assert.isTrue(
        supportsOmpSteering(makeInitializeResult(undefined, { steering: { supported: true } })),
      );
      assert.isFalse(supportsOmpSteering(makeInitializeResult({ steering: { supported: false } })));
      assert.isFalse(supportsOmpSteering(makeInitializeResult()));
    });

    it.effect(
      "sends active steering and followUp payloads and handles oh-my-pi outcome: injected | promptRequired | failed",
      () =>
        Effect.gen(function* () {
          const requests: Array<{ method: string; payload: unknown }> = [];
          const runtime = {
            request: (method: string, payload: unknown) =>
              Effect.sync(() => {
                requests.push({ method, payload });
                const queue =
                  (payload as { _meta?: { steering?: { queue?: string } } })._meta?.steering
                    ?.queue ?? "steering";
                return { outcome: "injected", queue };
              }),
          };

          const active = yield* sendOmpSteering(runtime, {
            sessionId: "sess-1",
            text: "Focus on unit tests first",
            queue: "steering",
          });
          assert.deepEqual(active, {
            outcome: "injected",
            injected: true,
            promptRequired: false,
            queue: "steering",
          });

          const followUp = yield* sendOmpSteering(runtime, {
            sessionId: "sess-1",
            text: "Then run build check",
            queue: "followUp",
          });
          assert.equal(followUp.outcome, "injected");
          assert.equal(followUp.queue, "followUp");
          assert.equal(requests.length, 2);
          assert.equal(requests[0]?.method, OMP_STEERING_METHOD);
          assert.deepEqual(requests[0]?.payload, {
            sessionId: "sess-1",
            prompt: [{ type: "text", text: "Focus on unit tests first" }],
            _meta: { steering: { queue: "steering" } },
          });
          assert.deepEqual(requests[1]?.payload, {
            sessionId: "sess-1",
            prompt: [{ type: "text", text: "Then run build check" }],
            _meta: { steering: { queue: "followUp" } },
          });

          const failedError = yield* sendOmpSteering(
            {
              request: () =>
                Effect.succeed({ outcome: "failed", reason: "Session closed during steer" }),
            },
            { sessionId: "sess-1", text: "Too late" },
          ).pipe(Effect.flip);
          assert.equal(failedError._tag, "AcpRequestError");
          if (failedError._tag === "AcpRequestError") {
            assert.include(failedError.errorMessage, "Session closed during steer");
          }
        }),
    );

    it.effect(
      "strictly decides whether host issues session/prompt based on outcome: injected vs promptRequired",
      () =>
        Effect.gen(function* () {
          let promptCalls = 0;
          const makeRuntime = (steeringResponse: Record<string, unknown>) => ({
            request: () => Effect.succeed(steeringResponse),
            prompt: () =>
              Effect.sync(() => {
                promptCalls += 1;
                return { stopReason: "end_turn" } as EffectAcpSchema.PromptResponse;
              }),
          });

          const injectedOutcome = yield* dispatchOmpSteeringOrPrompt(
            makeRuntime({ outcome: "injected", queue: "steering" }),
            { sessionId: "sess-1", text: "Steer immediately", queue: "steering" },
          );
          assert.equal(injectedOutcome.mode, "steered");
          assert.equal(promptCalls, 0);

          const fallbackOutcome = yield* dispatchOmpSteeringOrPrompt(
            makeRuntime({ outcome: "promptRequired", queue: "followUp" }),
            { sessionId: "sess-1", text: "Queue when idle", queue: "followUp" },
          );
          assert.equal(fallbackOutcome.mode, "prompted");
          assert.equal(promptCalls, 1);

          const flavorSteering = createOmpSteering();
          assert.isTrue(
            flavorSteering.supported?.(makeInitializeResult({ steering: { supported: true } })),
          );
          const sendResult = yield* flavorSteering.send(
            makeRuntime({ outcome: "promptRequired", queue: "steering" }) as never,
            "sess-1",
            "Fallback steer",
            [],
          );
          assert.deepEqual(sendResult, { injected: false, promptRequired: true });
        }),
    );
  });

  describe("2. pure ACP compliant usage limits (_omp/usage)", () => {
    it("maps canonical oh-my-pi UsageReport.limits (amount.usedFraction / window.durationMs / resetsAt) into ServerProviderUsageLimits", () => {
      const checkedAt = "2026-11-23T08:00:00.000Z";
      const resetMs = Date.parse("2026-11-23T13:00:00.000Z");
      const limits = mapOmpUsageReportsToLimits(
        {
          reports: [
            {
              provider: "anthropic",
              fetchedAt: Date.parse(checkedAt),
              limits: [
                {
                  id: "5h",
                  label: "5 Hour",
                  scope: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
                  window: {
                    id: "5h",
                    label: "5 Hour",
                    durationMs: 5 * 60 * 60 * 1000,
                    resetsAt: resetMs,
                  },
                  amount: { usedFraction: 0.42, unit: "percent" },
                },
                {
                  id: "7d",
                  label: "7 Day",
                  scope: { provider: "anthropic" },
                  window: {
                    id: "7d",
                    label: "7 Day",
                    durationMs: 7 * 24 * 60 * 60 * 1000,
                  },
                  amount: { remainingFraction: 0.22, unit: "percent" },
                },
              ],
            },
            {
              provider: "openai",
              fetchedAt: Date.parse(checkedAt),
              limits: [
                {
                  id: "monthly-tokens",
                  label: "Monthly Quota",
                  scope: { provider: "openai" },
                  amount: { used: 150, limit: 600, unit: "requests" },
                },
              ],
            },
          ],
        },
        checkedAt,
      );

      assert.equal(limits.checkedAt, checkedAt);
      assert.isUndefined(limits.unavailable);
      assert.equal(limits.windows.length, 3);
      assert.deepEqual(
        limits.windows.map((window) => ({
          id: window.id,
          kind: window.kind,
          usedPercent: Math.round(window.usedPercent),
          providerIds: window.providerIds,
          modelIds: window.modelIds,
          windowDurationMins: window.windowDurationMins,
        })),
        [
          {
            id: "anthropic:5h",
            kind: "session",
            usedPercent: 42,
            providerIds: ["anthropic"],
            modelIds: ["claude-sonnet-4-5"],
            windowDurationMins: 300,
          },
          {
            id: "anthropic:7d",
            kind: "weekly",
            usedPercent: 78,
            providerIds: ["anthropic"],
            modelIds: undefined,
            windowDurationMins: 10080,
          },
          {
            id: "openai:monthly-tokens",
            kind: "monthly",
            usedPercent: 25,
            providerIds: ["openai"],
            modelIds: undefined,
            windowDurationMins: undefined,
          },
        ],
      );
      assert.equal(limits.windows[0]?.resetsAt, "2026-11-23T13:00:00.000Z");
    });

    it.effect("reads usage purely via extRequest('_omp/usage', {}) and handles unsupported RPC", () =>
      Effect.gen(function* () {
        const calls: Array<{ method: string; payload: unknown }> = [];
        const okLimits = yield* fetchOmpUsageLimits(
          {
            request: (method, payload) =>
              Effect.sync(() => {
                calls.push({ method, payload });
                return {
                  reports: [
                    {
                      provider: "anthropic",
                      limits: [
                        {
                          id: "session",
                          label: "5h",
                          scope: { provider: "anthropic" },
                          amount: { unit: "percent", used: 35 },
                        },
                      ],
                    },
                  ],
                };
              }),
          },
          "2026-11-23T08:00:00.000Z",
        );

        assert.deepEqual(calls, [{ method: OMP_USAGE_METHOD, payload: {} }]);
        assert.equal(okLimits.windows[0]?.usedPercent, 35);

        const unsupported = yield* fetchOmpUsageLimits(
          {
            request: () =>
              Effect.fail(
                new EffectAcpErrors.AcpRequestError({
                  code: -32601,
                  errorMessage: "Method not found",
                }),
              ),
          },
          "2026-11-23T08:00:00.000Z",
        );
        assert.equal(unsupported.unavailable?.reason, "unsupported");
      }),
    );
  });

  describe("3. shell tool output cleaning & exit code normalization", () => {
    it("normalizes canonical OMP AgentToolResult rawOutput and strips echo/wall-time/exit notices", () => {
      const resultText =
        "PASS 12 tests\n\nWall time: 1.42 seconds\n\nCommand exited with code 0";
      const notification = {
        sessionId: "sess-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-orca-1",
          kind: "execute",
          status: "completed",
          rawInput: { command: "pnpm test" },
          content: [
            { type: "content", content: { type: "text", text: "$ pnpm test" } },
            { type: "content", content: { type: "text", text: resultText } },
            { type: "diff", path: "a.ts", oldText: "1", newText: "2" },
          ],
          rawOutput: {
            content: [{ type: "text", text: resultText }],
            details: { wallTimeMs: 1420 },
          },
        },
      } as unknown as EffectAcpSchema.SessionNotification;

      const normalized = normalizeOmpToolUpdate(notification);
      const update = normalized.update as {
        readonly content?: ReadonlyArray<{ type: string }>;
        readonly rawOutput?: Record<string, unknown>;
      };

      // Repeated echo and duplicate result text removed; non-output diff block preserved.
      assert.deepEqual(
        update.content?.map((block) => block.type),
        ["diff"],
      );
      assert.equal(update.rawOutput?.stdout, "PASS 12 tests");
      assert.equal(update.rawOutput?.exitCode, 0);
    });

    it("does NOT imply exitCode 0 for async, service, timedOut, or signaled completions", () => {
      for (const caseInput of [
        { details: { wallTimeMs: 500, async: { id: "bg-1" } }, rawInput: { command: "dev" } },
        { details: { wallTimeMs: 500, service: { port: 3000 } }, rawInput: { command: "dev" } },
        { details: { wallTimeMs: 500, timedOut: true }, rawInput: { command: "sleep 99" } },
        { details: { wallTimeMs: 500, signal: "SIGTERM" }, rawInput: { command: "sleep 99" } },
        { details: { wallTimeMs: 500 }, rawInput: { command: "dev", async: true } },
      ]) {
        const normalized = normalizeOmpToolUpdate({
          sessionId: "sess-1",
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tc-bg",
            kind: "execute",
            status: "completed",
            rawInput: caseInput.rawInput,
            content: [
              { type: "content", content: { type: "text", text: "$ dev" } },
              { type: "content", content: { type: "text", text: "started" } },
            ],
            rawOutput: {
              content: [{ type: "text", text: "started" }],
              details: caseInput.details,
            },
          },
        } as unknown as EffectAcpSchema.SessionNotification);

        const rawOutput = (normalized.update as { rawOutput?: Record<string, unknown> }).rawOutput;
        assert.equal(rawOutput?.stdout, "started");
        assert.isUndefined(rawOutput?.exitCode);
      }
    });

    it("strips duplicated $ <cmd> echo and exit code / wall time footers from inline shell text", () => {
      const cleaned = cleanOmpShellOutput(
        "$ pnpm test\nPASS 12 tests\n\nCommand exited with code 0\n\nWall time: 1.42s",
        "pnpm test",
      );
      assert.equal(cleaned.stdout, "PASS 12 tests");
      assert.equal(cleaned.exitCode, 0);
      assert.equal(cleaned.wallTimeSeconds, 1.42);
      assert.isTrue(cleaned.changed);

      const nonZero = cleanOmpShellOutput(
        "$ npm run lint\nerror TS2304: missing symbol\n\nWall time: 0.8 seconds\n\nCommand exited with code 2",
        "npm run lint",
      );
      assert.equal(nonZero.stdout, "error TS2304: missing symbol");
      assert.equal(nonZero.exitCode, 2);
      assert.equal(nonZero.wallTimeSeconds, 0.8);
    });

    it("remembers shell command & async context from tool_call across tool_call_update frames", () => {
      const normalize = createOmpSessionUpdateNormalizer();
      normalize({
        sessionId: "sess-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tc-2",
          kind: "execute",
          title: "Run tests",
          rawInput: { command: "echo hi" },
          status: "in_progress",
        },
      } as unknown as EffectAcpSchema.SessionNotification);

      const finalUpdate = normalize({
        sessionId: "sess-1",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "tc-2",
          status: "completed",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "$ echo hi\nhi\n\nWall time: 0.1s",
              },
            },
          ],
        },
      } as unknown as EffectAcpSchema.SessionNotification);

      const update = finalUpdate.update as {
        readonly content?: ReadonlyArray<{ content?: { text?: string } }>;
        readonly rawOutput?: Record<string, unknown>;
      };
      assert.equal(update.content?.[0]?.content?.text, "hi");
      assert.equal(update.rawOutput?.stdout, "hi");
      assert.equal(update.rawOutput?.exitCode, 0);
    });
  });

  describe("4. missing API key auth, compactionReply, sessionLost & /model role selector", () => {
    it("classifies -32603 'No API key found for ' as signed-out while keeping 'No model selected.' separate", () => {
      const missingKeyError = new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data: {
          details: "No API key found for anthropic. Run `omp login` to configure credentials.",
        },
      });

      assert.isTrue(reportsNoApiKey(missingKeyError));
      assert.isTrue(isOmpMissingApiKeyError(missingKeyError));
      assert.equal(
        extractOmpMissingApiKeyDetails(missingKeyError),
        "No API key found for anthropic. Run `omp login` to configure credentials.",
      );

      const probeFailure = acpRegistryProbeFailure(missingKeyError, [
        {
          id: "terminal",
          name: "Set up omp in terminal",
          description: "Launch the omp TUI to add provider keys and select models.",
          type: "terminal",
          command: "omp --acp-terminal-auth",
        },
      ]);
      assert.equal(probeFailure.reason, "authentication_failed");
      assert.include(probeFailure.message, "No API key found for anthropic");
      assert.include(probeFailure.message, "omp --acp-terminal-auth");

      const promptFailure = acpRegistryPromptFailure("omp", missingKeyError);
      assert.equal(promptFailure.class, "permission_error");
      assert.equal(promptFailure.code, "auth_required");
      assert.equal(promptFailure.retryable, false);
      assert.include(promptFailure.message, "terminal auth");

      // Orca omp-dialect.ts:10 — "No model selected." is NOT signed-out.
      const noModelError = new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data: { details: "No model selected." },
      });
      assert.isFalse(reportsNoApiKey(noModelError));
      assert.isTrue(isOmpNoModelSelectedError(noModelError));

      const unknownModelError = new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data: { details: "Unknown ACP model: smol" },
      });
      assert.isTrue(isOmpUnknownModelOptionError(unknownModelError));
    });

    it("detects OMP compaction skipped/failed replies and cancel-timeout lost sessions", () => {
      assert.deepEqual(parseOmpCompactionReply("Compaction failed: nothing to compact"), {
        outcome: "skipped",
        detail: "nothing to compact",
      });
      assert.deepEqual(
        parseOmpCompactionReply("Compaction failed: already compacted this session"),
        {
          outcome: "skipped",
          detail: "already compacted this session",
        },
      );
      assert.deepEqual(
        parseOmpCompactionReply("/compact does not take focus instructions in this mode"),
        {
          outcome: "failed",
          detail: "/compact does not take focus instructions in this mode",
        },
      );
      assert.isUndefined(parseOmpCompactionReply("Compacted 48 messages into a summary."));

      const cancelTimeout = new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data: { details: OMP_CANCEL_CLEANUP_TIMED_OUT },
      });
      assert.isTrue(isOmpLostSessionError(cancelTimeout, "sess-1"));

      const unsupportedSession = new EffectAcpErrors.AcpRequestError({
        code: -32603,
        errorMessage: "Internal error",
        data: { details: "Unsupported ACP session: sess-1" },
      });
      assert.isTrue(isOmpLostSessionError(unsupportedSession, "sess-1"));
      assert.isFalse(isOmpLostSessionError(unsupportedSession, "sess-other"));
    });

    it("parses /model <selector> role commands and distinguishes accepted / notSignedIn / modelUnavailable replies", () => {
      assert.deepEqual(parseOmpModelCommand("/model smol"), {
        selector: "smol",
        isRoleSelector: true,
      });
      assert.deepEqual(parseOmpModelCommand("/model slow"), {
        selector: "slow",
        isRoleSelector: true,
      });
      assert.deepEqual(parseOmpModelCommand("/model plan"), {
        selector: "plan",
        isRoleSelector: true,
      });
      assert.isTrue(isOmpModelRoleSelector("smol"));
      assert.isTrue(isOmpModelRoleSelector("slow"));
      assert.isTrue(isOmpModelRoleSelector("plan"));

      assert.deepEqual(parseOmpModelSwitchReply("Model set to anthropic/claude-3.5-haiku:high."), {
        kind: "set",
        modelId: "anthropic/claude-3.5-haiku:high",
        rawText: "Model set to anthropic/claude-3.5-haiku:high.",
      });
      assert.deepEqual(parseOmpModelSwitchReply("No API key found for openai."), {
        kind: "rejected",
        refusalReason: "notSignedIn",
        reason: "No API key found for openai.",
        rawText: "No API key found for openai.",
      });
      assert.deepEqual(parseOmpModelSwitchReply("Model not found: unknown-role"), {
        kind: "rejected",
        refusalReason: "modelUnavailable",
        reason: "Model not found: unknown-role",
        rawText: "Model not found: unknown-role",
      });
    });

    it.effect(
      "falls back to /model on Unknown ACP model (-32603) and surfaces notSignedIn vs modelUnavailable",
      () =>
        Effect.gen(function* () {
          const makeSwitchRuntime = (replyText: string, failOptionWithUnknown = false) => {
            const handlerRef = Ref.makeUnsafe<
              | ((
                  notification: EffectAcpSchema.SessionNotification,
                ) => Effect.Effect<void, EffectAcpErrors.AcpError>)
              | null
            >(null);
            const sentPrompts: Array<string> = [];
            return {
              sentPrompts,
              runtime: {
                getConfigOptions: Effect.succeed([]),
                setConfigOption: () => Effect.void,
                setSessionModel: (modelId: string) =>
                  failOptionWithUnknown
                    ? Effect.fail(
                        new EffectAcpErrors.AcpRequestError({
                          code: -32603,
                          errorMessage: "Internal error",
                          data: { details: `Unknown ACP model: ${modelId}` },
                        }),
                      )
                    : Effect.void,
                handleSessionUpdate: (
                  handler: (
                    notification: EffectAcpSchema.SessionNotification,
                  ) => Effect.Effect<void, EffectAcpErrors.AcpError>,
                ) => Ref.set(handlerRef, handler),
                prompt: (request: { readonly prompt: ReadonlyArray<EffectAcpSchema.ContentBlock> }) =>
                  Effect.gen(function* () {
                    const firstBlock = request.prompt[0];
                    if (firstBlock && firstBlock.type === "text") {
                      sentPrompts.push(firstBlock.text);
                    }
                    const handler = yield* Ref.get(handlerRef);
                    if (handler) {
                      yield* handler({
                        sessionId: "sess-1",
                        update: {
                          sessionUpdate: "agent_message_chunk",
                          content: { type: "text", text: replyText },
                        },
                      } as EffectAcpSchema.SessionNotification);
                    }
                    return { stopReason: "end_turn" } as EffectAcpSchema.PromptResponse;
                  }),
              },
            };
          };

          const acceptedHarness = makeSwitchRuntime("Model set to anthropic/claude-haiku-4-5.", true);
          const accepted = yield* switchOmpModelViaCommand(acceptedHarness.runtime, "smol");
          assert.deepEqual(acceptedHarness.sentPrompts, ["/model smol"]);
          assert.deepEqual(accepted, {
            kind: "set",
            modelId: "anthropic/claude-haiku-4-5",
            rawText: "Model set to anthropic/claude-haiku-4-5.",
          });

          const selected = yield* applyOmpModelSelection({
            runtime: acceptedHarness.runtime as never,
            startResult: {
              sessionId: "sess-1",
              initializeResult: makeInitializeResult(),
              sessionSetupResult: { models: { currentModelId: "default", availableModels: [] } },
            } as never,
            modelSelection: { provider: "acpRegistry", model: "custom/alias" } as never,
          });
          assert.equal(selected, "anthropic/claude-haiku-4-5");
          assert.deepEqual(acceptedHarness.sentPrompts, ["/model smol", "/model custom/alias"]);

          const unavailableHarness = makeSwitchRuntime("No model configured for role 'slow'.");
          const unavailableError = yield* applyOmpModelSelection({
            runtime: unavailableHarness.runtime as never,
            startResult: {
              sessionId: "sess-1",
              initializeResult: makeInitializeResult(),
              sessionSetupResult: { models: { currentModelId: "default", availableModels: [] } },
            } as never,
            modelSelection: { provider: "acpRegistry", model: "slow" } as never,
          }).pipe(Effect.flip);
          assert.equal(unavailableError._tag, "AcpRequestError");
          if (unavailableError._tag === "AcpRequestError") {
            assert.equal(unavailableError.code, -32602);
            assert.include(unavailableError.errorMessage, "No model configured for role 'slow'");
          }

          const signedOutHarness = makeSwitchRuntime("No API key found for openai.");
          const signedOutError = yield* applyOmpModelSelection({
            runtime: signedOutHarness.runtime as never,
            startResult: {
              sessionId: "sess-1",
              initializeResult: makeInitializeResult(),
              sessionSetupResult: { models: { currentModelId: "default", availableModels: [] } },
            } as never,
            modelSelection: { provider: "acpRegistry", model: "plan" } as never,
          }).pipe(Effect.flip);
          assert.isTrue(reportsNoApiKey(signedOutError));
        }),
    );
  });

  describe("5. OMP askDialog elicitation form", () => {
    it("extracts qN + qN__other schema and formats accepted answers", () => {
      const form = extractOmpElicitationForm({
        mode: "form",
        message: "Pick a target",
        requestedSchema: {
          type: "object",
          properties: {
            q1: {
              type: "string",
              title: "Which package manager?",
              description: "Toolchain",
              oneOf: [
                { const: "pnpm", title: "pnpm", description: "Workspace default" },
                { const: "npm", title: "npm" },
              ],
            },
            q1__other: {
              type: "string",
              title: "Other (type your own)",
            },
          },
        },
      } as never);

      assert.isDefined(form);
      assert.equal(form?.questions.length, 1);
      assert.deepEqual(form?.respond({ q1: "pnpm" }), {
        action: "accept",
        content: { q1: "pnpm" },
      });
      assert.deepEqual(form?.respond({ q1: "bun" }), {
        action: "accept",
        content: { q1__other: "bun" },
      });
    });
  });
});
