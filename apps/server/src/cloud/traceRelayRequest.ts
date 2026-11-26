import type * as Effect from "effect/Effect";

/** Prismux hard-disables cloud relay tracing; all request trace wrappers are zero-overhead no-ops. */
export const traceRelayRequest = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => effect;

export const traceAuthenticatedRelayRequest = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  _authentication?: { readonly startTime: bigint; readonly endTime: bigint },
): Effect.Effect<A, E, R> => effect;

export const traceLocalHandlerWork = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => effect;
