import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSetupError, type ProviderAuthState } from "@prismux/core-contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as AcpErrors from "@prismux/effect-acp/errors";
import type * as AcpSchema from "@prismux/effect-acp/compat";

import {
  makeAntigravityAuth,
  type AntigravityAuth,
  type AntigravityAuthRuntime,
} from "./AntigravityAuth.ts";
import { ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE } from "./antigravityAuthSupport.ts";
import type * as AcpSessionRuntime from "@prismux/provider-acp/server/AcpSessionRuntime";

const instanceId = ProviderInstanceId.make("antigravity-auth-test");
const owner = "t3-auth-session-owner";
const otherOwner = "t3-auth-session-other";

const initialized = {
  protocolVersion: 1,
  authMethods: [],
  agentCapabilities: {},
} satisfies AcpSchema.InitializeResponse;

const started: AcpSessionRuntime.AcpSessionRuntimeStartResult = {
  sessionId: "native-session",
  initializeResult: initialized,
  sessionSetupResult: {
    sessionId: "native-session",
    models: {
      currentModelId: "gemini-test",
      availableModels: [{ modelId: "gemini-test", name: "Gemini test" }],
    },
  },
  modelConfigId: "model",
};

const phase = (auth: AntigravityAuth, value: ProviderAuthState["phase"], sessionId = owner) =>
  auth.controller.subscribe(sessionId).pipe(
    Stream.filter((state) => state.phase === value),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

const makeHarness = Effect.fn("makeAuthTestHarness")(function* (
  options: {
    readonly beforeInitialize?: Effect.Effect<void>;
  } = {},
) {
  const sessionReady = yield* Deferred.make<void, AcpErrors.AcpError>();
  const startCalled = yield* Deferred.make<void>();
  const closed = yield* Deferred.make<void>();
  const events: string[] = [];
  let catalog = ["previous-account-model"];

  const auth = yield* makeAntigravityAuth({
    instanceId,
    makeRuntime: () =>
      Effect.gen(function* () {
        events.push("process-open");
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            events.push("process-close");
            yield* Deferred.succeed(closed, undefined);
          }),
        );
        const initialize = yield* Effect.cached(
          Effect.gen(function* () {
            events.push("initialize");
            yield* options.beforeInitialize ?? Effect.void;
            return initialized;
          }),
        );
        return {
          initialize: () => initialize,
          start: () =>
            Effect.gen(function* () {
              yield* initialize;
              events.push("session-start");
              yield* Deferred.succeed(startCalled, undefined);
              yield* Deferred.await(sessionReady);
              return started;
            }),
        } satisfies AntigravityAuthRuntime;
      }),
    onAuthenticated: () =>
      Effect.sync(() => {
        catalog = ["gemini-test"];
        events.push("catalog-published");
      }),
    onSignedOut: Effect.sync(() => {
      catalog = [];
      events.push("catalog-cleared");
    }),
  });

  return {
    auth,
    sessionReady,
    startCalled,
    closed,
    events,
    catalog: () => catalog,
  };
});

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("AntigravityAuth (local-cli)", (it) => {
  it.effect("connects strictly via local agy CLI without browser OAuth or callbacks", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const state = yield* harness.auth.controller.start(owner);
      assert.isNotNull(state.flowId);
      assert.equal(state.phase, "starting");
      assert.isNull(state.authorizationUrl);

      yield* Deferred.await(harness.startCalled);
      const other = yield* phase(harness.auth, "starting", otherOwner);
      assert.isNull(other.flowId);
      assert.isNull(other.authorizationUrl);
      assert.isNull(other.interaction);

      yield* Deferred.succeed(harness.sessionReady, undefined);
      const succeeded = yield* phase(harness.auth, "succeeded");
      assert.equal(succeeded.message, "Connected via local agy CLI.");
      assert.isNull(succeeded.authorizationUrl);
      assert.isNull(succeeded.expiresAt);
      assert.deepEqual(harness.catalog(), ["gemini-test"]);
      assert.deepEqual(harness.events, [
        "process-open",
        "initialize",
        "session-start",
        "catalog-published",
        "process-close",
      ]);
    }),
  );

  it.effect("rejects in-app OAuth complete() and respond() calls unconditionally", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const completeExit = yield* harness.auth.controller
        .complete(owner, { flowId: "flow-1", callbackUrl: "http://127.0.0.1:51234/?code=x" })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(completeExit));

      const respondExit = yield* harness.auth.controller
        .respond!(owner, {
          instanceId,
          flowId: "flow-1",
          interactionId: "flow-1",
          response: { type: "credentials", values: { code: "4/0Ab-code" } },
        })
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(respondExit));
    }),
  );

  it.effect("guides unauthenticated users to sign in via local agy CLI", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.auth.controller.start(owner);
      yield* Deferred.await(harness.startCalled);
      yield* Deferred.fail(harness.sessionReady, AcpErrors.AcpRequestError.authRequired());

      const failed = yield* phase(harness.auth, "failed");
      assert.equal(failed.message, ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE);
      assert.isNull(failed.authorizationUrl);
      assert.deepEqual(harness.catalog(), ["previous-account-model"]);
      yield* Deferred.await(harness.closed);
    }),
  );

  it.effect("distinguishes post-initialize session/new errors without exposing raw payloads", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.auth.controller.start(owner);
      yield* Deferred.await(harness.startCalled);
      yield* Deferred.fail(
        harness.sessionReady,
        new AcpErrors.AcpRequestError({
          code: -32603,
          errorMessage: "Internal error sensitive-payload",
          method: "session/new",
        }),
      );
      const failed = yield* phase(harness.auth, "failed");
      assert.equal(
        failed.message,
        "Local agy CLI connected, but could not initialize a session or load models.",
      );
      assert.notInclude(failed.message ?? "", "sensitive-payload");
      yield* Deferred.await(harness.closed);
    }),
  );

  it.effect("reports unexpected process exits cleanly without leaking stderr", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.auth.controller.start(owner);
      yield* Deferred.await(harness.startCalled);
      yield* Deferred.fail(
        harness.sessionReady,
        new AcpErrors.AcpProcessExitedError({
          signal: "SIGILL",
          stderr: "runtime crashed secret-trace",
        }),
      );
      const failed = yield* phase(harness.auth, "failed");
      assert.include(failed.message ?? "", "exited unexpectedly");
      assert.include(failed.message ?? "", "SIGILL");
      assert.notInclude(failed.message ?? "", "secret-trace");
    }),
  );

  it.effect("publishes 30s hint and 300s timeout when local agy CLI stops responding after initialize", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      yield* harness.auth.controller.start(owner);
      yield* Deferred.await(harness.startCalled);

      yield* TestClock.adjust("30 seconds");
      const stalled = yield* harness.auth.controller.subscribe(owner).pipe(
        Stream.filter((state) => state.message?.includes("30 seconds") === true),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
      assert.equal(stalled.phase, "starting");

      yield* TestClock.adjust("270 seconds");
      const failed = yield* phase(harness.auth, "failed");
      assert.include(failed.message ?? "", "could not finish connecting");

      yield* harness.auth.onSignedInElsewhere;
      const cleared = yield* phase(harness.auth, "idle");
      assert.isNull(cleared.message);
    }),
  );

  it.effect("reports runtime startup stall when initialize never responds", () =>
    Effect.gen(function* () {
      const initializing = yield* Deferred.make<void>();
      const harness = yield* makeHarness({
        beforeInitialize: Deferred.succeed(initializing, undefined).pipe(
          Effect.andThen(Effect.never),
        ),
      });
      yield* harness.auth.controller.start(owner);
      yield* Deferred.await(initializing);

      yield* TestClock.adjust("90 seconds");
      const stalled = yield* harness.auth.controller.subscribe(owner).pipe(
        Stream.filter((state) => state.message !== "Connecting to local agy CLI."),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
      assert.equal(stalled.phase, "starting");
      assert.match(stalled.message ?? "", /not started|stuck/i);

      yield* TestClock.adjust("210 seconds");
      const failed = yield* phase(harness.auth, "failed");
      assert.match(failed.message ?? "", /not respond|may not run/i);
    }),
  );

  it.effect("cancels cleanly and rejects cancellation by another client", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const state = yield* harness.auth.controller.start(owner);
      yield* Deferred.await(harness.startCalled);

      const wrongOwner = yield* harness.auth.controller
        .cancel(otherOwner, state.flowId!)
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(wrongOwner));

      const cancelled = yield* harness.auth.controller.cancel(owner, state.flowId!);
      assert.equal(cancelled.phase, "cancelled");
      yield* Deferred.await(harness.closed);
      assert.deepEqual(harness.catalog(), ["previous-account-model"]);
    }),
  );

  it.effect("reuses active flow for the same owner and rejects competing clients", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const first = yield* harness.auth.controller.start(owner);
      yield* Deferred.await(harness.startCalled);
      const second = yield* harness.auth.controller.start(owner);
      assert.equal(first.flowId, second.flowId);
      const competing = yield* harness.auth.controller.start(otherOwner).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(competing));
      yield* harness.auth.controller.cancel(owner, first.flowId!);
    }),
  );

  it.effect("disconnects locally without wiping global agy CLI sign-in and interrupts startups", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const entering = yield* Deferred.make<void>();
      const continueStartup = yield* Deferred.make<void>();
      const processScope = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(processScope, Exit.void));

      const startup = yield* harness.auth
        .withProcess(
          Scope.close(processScope, Exit.void),
          Effect.gen(function* () {
            yield* Deferred.succeed(entering, undefined);
            yield* Deferred.await(continueStartup);
            harness.events.push("late-spawn");
          }),
        )
        .pipe(Scope.provide(processScope), Effect.forkScoped);

      yield* Deferred.await(entering);
      const result = yield* harness.auth.controller.logout(Effect.void);
      yield* Deferred.succeed(continueStartup, undefined);
      assert.isTrue(Exit.isFailure(yield* Fiber.await(startup)));
      assert.equal(result.phase, "idle");
      assert.equal(result.message, "Disconnected local agy CLI session.");
      assert.deepEqual(harness.events, ["catalog-cleared"]);
      assert.deepEqual(harness.catalog(), []);
    }),
  );

  it.effect("closes owned processes when stopSessions fails during disconnect", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const processScope = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(processScope, Exit.void));
      yield* harness.auth
        .withProcess(
          Effect.gen(function* () {
            harness.events.push("chat-close");
            yield* Scope.close(processScope, Exit.void);
          }),
          Effect.void,
        )
        .pipe(Scope.provide(processScope));

      const result = yield* harness.auth.controller
        .logout(
          Effect.fail(
            new ProviderSetupError({
              instanceId,
              operation: "stopSessions",
              detail: "Stop failed.",
            }),
          ),
        )
        .pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(result));
      assert.deepEqual(harness.events, ["chat-close"]);
      assert.deepEqual(harness.catalog(), ["previous-account-model"]);
    }),
  );
});
