// Prismux hard-disables upstream PostHog / T3 ingest analytics.
import * as HostProcess from "@prismux/core-shared/HostProcess";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import type { TelemetryOwner } from "./Identify.ts";

/**
 * Prismux hard-disables all upstream PostHog / T3 ingest product analytics at
 * both configuration defaults and runtime transport layers. Even if legacy
 * `PRISMUX_TELEMETRY_ENABLED=true` or `PRISMUX_POSTHOG_HOST` values exist in the
 * environment or managed policy, zero events are buffered and zero HTTP requests
 * are ever sent.
 */
export const PRISMUX_TELEMETRY_HARD_DISABLED = true as const;

const TelemetryEnvConfig = Config.all({
  posthogKey: Config.String("PRISMUX_POSTHOG_KEY").pipe(Config.withDefault("")),
  posthogHost: Config.String("PRISMUX_POSTHOG_HOST").pipe(Config.withDefault("")),
  enabled: Config.Boolean("PRISMUX_TELEMETRY_ENABLED").pipe(Config.withDefault(false)),
  flushBatchSize: Config.Number("PRISMUX_TELEMETRY_FLUSH_BATCH_SIZE").pipe(Config.withDefault(20)),
  maxBufferedEvents: Config.Number("PRISMUX_TELEMETRY_MAX_BUFFERED_EVENTS").pipe(
    Config.withDefault(1_000),
  ),
  wslDistroName: Config.String("WSL_DISTRO_NAME").pipe(Config.option),
});

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<void>;

    readonly flush: Effect.Effect<void>;

    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      observedBy: "server" | "client",
    ) => Effect.Effect<void>;
  }
>()("@prismux/server/telemetry/AnalyticsService") {}

/** @public */
export const make = Effect.gen(function* () {
  // Keep layer service dependencies compatible while guaranteeing zero file reads,
  // zero timers, and zero outbound HTTP requests under all configurations.
  yield* TelemetryEnvConfig;
  yield* HostProcess.Environment;
  yield* ManagedPolicy.ManagedPolicy;
  yield* HttpClient.HttpClient;
  yield* ServerConfig.ServerConfig;
  yield* SecureRandom.SecureRandom;
  yield* HostProcess.Platform;
  yield* HostProcess.Architecture;

  const record = Effect.fnUntraced(function* (
    _event: string,
    _properties?: Readonly<Record<string, unknown>>,
  ) {});
  const recordOwners = Effect.fnUntraced(function* (
    _owners: ReadonlyArray<TelemetryOwner>,
    _observedBy: "server" | "client",
  ) {});

  return AnalyticsService.of({
    record,
    flush: Effect.void,
    recordOwners,
  });
});

export const layer = Layer.effect(AnalyticsService, make);
