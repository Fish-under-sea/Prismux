import {
  ProviderSetupError,
  type ProviderAuthState,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as AcpErrors from "effect-acp/errors";

import type * as AcpSessionRuntime from "@t3tools/provider-acp/server/AcpSessionRuntime";
import {
  ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE,
  isAntigravitySignInRequiredError,
} from "./antigravityAuthSupport.ts";
import type { ProviderAuthController } from "./ProviderAuthService.ts";

const AUTH_TIMEOUT_MS = 300_000;
const NO_RESPONSE_HINT_MS = 30_000;
const STARTUP_HINT_MS = 90_000;
const NOT_STARTED_MESSAGE =
  "Antigravity has not started after 90 seconds. Its runtime may be stuck starting on this machine.";
const NOT_RESPONDING_MESSAGE =
  "Antigravity did not respond. Its runtime may not run on this machine.";
const NO_RESPONSE_MESSAGE =
  "Local agy CLI has not responded after 30 seconds. Check that you are signed in via 'agy' in a terminal and check your network connection.";
const UNREACHABLE_MESSAGE =
  "Local agy CLI could not finish connecting. Sign in with 'agy' or 'agy acp --login' in a terminal, then reconnect.";
const UNSUPPORTED_IN_APP_OAUTH_MESSAGE =
  "Antigravity uses your official local agy CLI session and does not accept in-app OAuth callbacks or codes. Sign in in a terminal with 'agy' or 'agy acp --login', then reconnect.";

const isSetupError = Schema.is(ProviderSetupError);
const isAcpRequestError = Schema.is(AcpErrors.AcpRequestError);
const isAcpProcessExitedError = Schema.is(AcpErrors.AcpProcessExitedError);

interface AuthSnapshot {
  readonly ownerSessionId: string | null;
  readonly state: ProviderAuthState;
}

interface AuthFlow {
  readonly id: string;
  readonly ownerSessionId: string;
  readonly expiresAtMillis: number;
  state: ProviderAuthState;
  initialized: boolean;
  fiber: Fiber.Fiber<void> | undefined;
}

interface OwnedProcess {
  readonly stop: Effect.Effect<void>;
  startup: Fiber.Fiber<unknown, unknown> | undefined;
}

export interface AntigravityAuth {
  readonly controller: ProviderAuthController;
  readonly withProcess: <A, E, R>(
    stop: Effect.Effect<void>,
    task: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ProviderSetupError, R | Scope.Scope>;
  /** A session started outside a flow, so an earlier flow's failure no longer describes sign-in. */
  readonly onSignedInElsewhere: Effect.Effect<void>;
}

export type AntigravityAuthRuntime = Pick<
  AcpSessionRuntime.AcpSessionRuntime["Service"],
  "initialize" | "start"
>;

export interface AntigravityAuthOptions<
  Runtime extends AntigravityAuthRuntime = AcpSessionRuntime.AcpSessionRuntime["Service"],
> {
  readonly instanceId: ProviderInstanceId;
  readonly makeRuntime: () => Effect.Effect<
    Runtime,
    AcpErrors.AcpError | ProviderSetupError,
    Scope.Scope
  >;
  readonly onAuthenticated: (
    result: AcpSessionRuntime.AcpSessionRuntimeStartResult,
    runtime: Runtime,
  ) => Effect.Effect<void>;
  readonly onSignedOut: Effect.Effect<void>;
}

function visibleSnapshot(snapshot: AuthSnapshot, ownerSessionId: string): ProviderAuthState {
  if (snapshot.ownerSessionId === null || snapshot.ownerSessionId === ownerSessionId) {
    return snapshot.state;
  }
  const busy = ["starting", "waiting", "verifying"].includes(snapshot.state.phase);
  return {
    ...snapshot.state,
    flowId: null,
    authorizationUrl: null,
    interaction: null,
    expiresAt: null,
    ...(busy ? { message: "Local agy CLI connection is in progress in another client." } : {}),
  };
}

function safeAuthFailure(cause: Cause.Cause<unknown>): string {
  const error = Cause.findErrorOption(cause);
  if (Option.isSome(error)) {
    if (isSetupError(error.value)) {
      return error.value.detail;
    }
    if (isAntigravitySignInRequiredError(error.value)) {
      return ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE;
    }
    if (isAcpProcessExitedError(error.value)) {
      const { code, signal } = error.value;
      const reason =
        signal !== undefined
          ? ` after signal ${signal}`
          : code !== undefined
            ? ` with code ${code}`
            : "";
      return `Local agy CLI exited unexpectedly${reason}. Check your local agy CLI installation and retry.`;
    }
    if (isAcpRequestError(error.value)) {
      if (error.value.errorMessage.includes("SUBSCRIPTION_REQUIRED")) {
        return "Google requires an eligible Antigravity subscription for this account.";
      }
      if (error.value.method === "session/new" && error.value.code === -32603) {
        return "Local agy CLI connected, but could not initialize a session or load models.";
      }
    }
  }
  return "Could not connect to local agy CLI. Sign in with 'agy' or 'agy acp --login' in a terminal and try again.";
}

export const makeAntigravityAuth = Effect.fn("makeAntigravityAuth")(function* <
  Runtime extends AntigravityAuthRuntime,
>(
  options: AntigravityAuthOptions<Runtime>,
): Effect.fn.Return<AntigravityAuth, never, SecureRandom.SecureRandom | Scope.Scope> {
  const random = yield* SecureRandom.SecureRandom;
  const instanceScope = yield* Scope.Scope;
  const lock = yield* Semaphore.make(1);
  const closed = yield* Deferred.make<void>();
  const emptyState: ProviderAuthState = {
    instanceId: options.instanceId,
    phase: "idle",
    flowId: null,
    authorizationUrl: null,
    expiresAt: null,
    message: null,
  };
  const snapshot = yield* SubscriptionRef.make<AuthSnapshot>({
    ownerSessionId: null,
    state: emptyState,
  });
  const processes = new Set<OwnedProcess>();
  let activeFlow: AuthFlow | undefined;
  let operation: "idle" | "auth" | "logout" | "cancel" | "closed" = "idle";

  const setupError = (name: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation: name, detail });
  const currentState = (ownerSessionId: string) =>
    SubscriptionRef.get(snapshot).pipe(
      Effect.map((value) => visibleSnapshot(value, ownerSessionId)),
    );
  const publishFlow = (flow: AuthFlow, state: ProviderAuthState) => {
    flow.state = state;
    return SubscriptionRef.set(snapshot, {
      ownerSessionId: flow.ownerSessionId,
      state,
    });
  };
  const stopOwnedProcesses = Effect.suspend(() =>
    Effect.forEach(
      Array.from(processes),
      (owned) =>
        Effect.gen(function* () {
          if (owned.startup) {
            yield* Fiber.interrupt(owned.startup);
          }
          yield* owned.stop;
        }),
      { discard: true, concurrency: "unbounded" },
    ),
  );

  const withProcess: AntigravityAuth["withProcess"] = (stop, task) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const owned: OwnedProcess = { stop, startup: undefined };
        const fiber = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            if (operation !== "idle") {
              return yield* setupError(
                "startProcess",
                "Local agy CLI connection or disconnect is in progress. Try again after it finishes.",
              );
            }
            processes.add(owned);
            yield* Scope.addFinalizer(
              scope,
              Effect.sync(() => {
                processes.delete(owned);
              }),
            );
            const child = yield* restore(task).pipe(Effect.forkIn(scope));
            owned.startup = child;
            return child;
          }),
        );
        // Propagate interruption after the exit wait so concurrent stop waiters stay attached.
        return yield* restore(Fiber.await(fiber)).pipe(
          Effect.flatten,
          Effect.ensuring(Fiber.interrupt(fiber)),
          Effect.ensuring(
            Effect.sync(() => {
              owned.startup = undefined;
            }),
          ),
        );
      }),
    );

  const finishFlow = (flow: AuthFlow, result: Exit.Exit<void, unknown>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        if (activeFlow !== flow) return;
        activeFlow = undefined;
        operation = "idle";
        yield* publishFlow(flow, {
          ...flow.state,
          phase: Exit.isSuccess(result) ? "succeeded" : "failed",
          authorizationUrl: null,
          expiresAt: null,
          message: Exit.isSuccess(result)
            ? "Connected via local agy CLI."
            : safeAuthFailure(result.cause),
        });
      }),
    );

  const publishStartingHint = (flow: AuthFlow, delayMs: number, message: string) =>
    Effect.sleep(delayMs).pipe(
      Effect.andThen(
        lock.withPermits(1)(
          Effect.gen(function* () {
            if (activeFlow !== flow || flow.state.phase !== "starting") return;
            yield* publishFlow(flow, { ...flow.state, message });
          }),
        ),
      ),
      Effect.forkScoped,
    );

  const runConnect = Effect.fn("AntigravityAuth.runConnect")(
    function* (flow: AuthFlow, stopSessions: Effect.Effect<void, ProviderSetupError>) {
      yield* stopSessions.pipe(Effect.ensuring(stopOwnedProcesses));
      const runtime = yield* options.makeRuntime();
      const startupHint = yield* publishStartingHint(flow, STARTUP_HINT_MS, NOT_STARTED_MESSAGE);
      // `start` reuses this memoized handshake.
      yield* runtime.initialize();
      flow.initialized = true;
      yield* Fiber.interrupt(startupHint);
      yield* publishStartingHint(flow, NO_RESPONSE_HINT_MS, NO_RESPONSE_MESSAGE);
      const started = yield* runtime.start();
      yield* lock.withPermits(1)(
        Effect.gen(function* () {
          if (activeFlow !== flow) return;
          yield* publishFlow(flow, {
            ...flow.state,
            phase: "verifying",
            authorizationUrl: null,
            message: "Checking local agy CLI and loading models.",
          });
        }),
      );
      yield* options.onAuthenticated(started, runtime);
    },
    (effect, flow, _stopSessions) =>
      effect.pipe(
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: AUTH_TIMEOUT_MS,
          orElse: () =>
            Effect.fail(
              setupError(
                "start",
                flow.initialized ? UNREACHABLE_MESSAGE : NOT_RESPONDING_MESSAGE,
              ),
            ),
        }),
        Effect.exit,
        Effect.flatMap((result) => finishFlow(flow, result)),
      ),
  );

  const stopFlow = (flow: AuthFlow, phase: "cancelled" | "failed", message: string) =>
    Effect.uninterruptible(
      Effect.gen(function* () {
        const detached = yield* lock.withPermits(1)(
          Effect.gen(function* () {
            if (activeFlow !== flow) return false;
            activeFlow = undefined;
            operation = "cancel";
            yield* publishFlow(flow, {
              ...flow.state,
              phase,
              authorizationUrl: null,
              expiresAt: null,
              message,
            });
            return true;
          }),
        );
        if (!detached) return;
        if (flow.fiber) yield* Fiber.interrupt(flow.fiber);
        yield* lock.withPermits(1)(
          Effect.sync(() => {
            if (operation === "cancel") operation = "idle";
          }),
        );
      }),
    );

  const requireFlow = Effect.fn("AntigravityAuth.requireFlow")(function* (
    ownerSessionId: string,
    flowId: string,
    name: string,
  ) {
    const flow = activeFlow;
    if (!flow || flow.id !== flowId || flow.ownerSessionId !== ownerSessionId) {
      return yield* setupError(name, "This connection is no longer active in this client.");
    }
    const now = yield* Clock.currentTimeMillis;
    if (now >= flow.expiresAtMillis) {
      return yield* setupError(name, "Local agy CLI connection expired. Try again.");
    }
    return flow;
  });

  const controller: ProviderAuthController = {
    start: (ownerSessionId, stopSessions = Effect.void) =>
      lock.withPermits(1)(
        Effect.uninterruptible(
          Effect.gen(function* () {
            if (activeFlow?.ownerSessionId === ownerSessionId && operation === "auth") {
              return activeFlow.state;
            }
            if (operation !== "idle") {
              return yield* setupError("start", "Antigravity setup is already in progress.");
            }
            const flowId = yield* random
              .uuidV4()
              .pipe(
                Effect.mapError(() =>
                  setupError("start", "Could not start local agy CLI connection. Try again."),
                ),
              );
            const expiresAtMillis = (yield* Clock.currentTimeMillis) + AUTH_TIMEOUT_MS;
            const state: ProviderAuthState = {
              ...emptyState,
              phase: "starting",
              flowId,
              expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expiresAtMillis)),
              message: "Connecting to local agy CLI.",
            };
            const flow: AuthFlow = {
              id: flowId,
              ownerSessionId,
              expiresAtMillis,
              state,
              initialized: false,
              fiber: undefined,
            };
            activeFlow = flow;
            operation = "auth";
            yield* publishFlow(flow, state);
            flow.fiber = yield* runConnect(flow, stopSessions).pipe(
              Effect.interruptible,
              Effect.forkIn(instanceScope),
            );
            return state;
          }),
        ),
      ),
    complete: () => setupError("complete", UNSUPPORTED_IN_APP_OAUTH_MESSAGE),
    respond: () => setupError("respond", UNSUPPORTED_IN_APP_OAUTH_MESSAGE),
    cancel: Effect.fn("AntigravityAuth.cancel")(function* (ownerSessionId, flowId) {
      const flow = yield* lock.withPermits(1)(requireFlow(ownerSessionId, flowId, "cancel"));
      yield* stopFlow(flow, "cancelled", "Local agy CLI connection was cancelled.");
      return flow.state;
    }),
    logout: Effect.fn("AntigravityAuth.logout")(function* (stopSessions) {
      const task = Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const flow = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              if (operation !== "idle" && operation !== "auth") {
                return yield* setupError("logout", "Antigravity setup is already stopping.");
              }
              operation = "logout";
              const currentFlow = activeFlow;
              activeFlow = undefined;
              if (currentFlow) {
                yield* publishFlow(currentFlow, {
                  ...currentFlow.state,
                  phase: "cancelled",
                  authorizationUrl: null,
                  expiresAt: null,
                  message: "Local agy CLI connection was cancelled by disconnect.",
                });
              }
              return currentFlow;
            }),
          );
          const stopRemaining = Effect.gen(function* () {
            if (flow?.fiber) yield* Fiber.interrupt(flow.fiber);
            yield* stopOwnedProcesses;
          });
          const result = yield* restore(
            Effect.gen(function* () {
              yield* stopSessions.pipe(Effect.ensuring(stopRemaining));
              // Keep the user's global `~/.gemini/antigravity-cli` sign-in intact.
              yield* options.onSignedOut;
            }).pipe(
              Effect.scoped,
              Effect.timeoutOrElse({
                duration: "90 seconds",
                orElse: () =>
                  Effect.fail(setupError("logout", "Local agy CLI disconnect timed out.")),
              }),
            ),
          ).pipe(Effect.exit);
          yield* lock.withPermits(1)(
            Effect.gen(function* () {
              operation = "idle";
              yield* SubscriptionRef.set(snapshot, {
                ownerSessionId: null,
                state: {
                  ...emptyState,
                  phase: Exit.isSuccess(result) ? "idle" : "failed",
                  message: Exit.isSuccess(result)
                    ? "Disconnected local agy CLI session."
                    : "Local agy CLI disconnect failed. Try again.",
                },
              });
            }),
          );
          if (Exit.isFailure(result)) {
            const failure = Cause.findErrorOption(result.cause);
            return yield* Option.isSome(failure) && isSetupError(failure.value)
              ? failure.value
              : setupError("logout", "Local agy CLI disconnect failed. Try again.");
          }
          return yield* currentState("");
        }),
      );
      const worker = yield* task.pipe(Effect.forkIn(instanceScope));
      return yield* Fiber.await(worker).pipe(Effect.flatten);
    }),
    subscribe: (ownerSessionId) =>
      SubscriptionRef.changes(snapshot).pipe(
        Stream.map((value) => ({
          ...visibleSnapshot(value, ownerSessionId),
          credentialOwner: "provider" as const,
          interaction: null,
        })),
        Stream.interruptWhen(Deferred.await(closed)),
      ),
  };

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      operation = "closed";
      const flow = activeFlow;
      activeFlow = undefined;
      if (flow?.fiber) {
        yield* Fiber.interrupt(flow.fiber);
      }
      yield* stopOwnedProcesses;
      yield* Deferred.succeed(closed, undefined);
    }),
  );

  const onSignedInElsewhere = SubscriptionRef.update(snapshot, (value) =>
    activeFlow === undefined &&
    operation === "idle" &&
    (value.state.phase === "failed" || value.state.phase === "cancelled")
      ? { ownerSessionId: null, state: emptyState }
      : value,
  );

  return { controller, withProcess, onSignedInElsewhere };
});
