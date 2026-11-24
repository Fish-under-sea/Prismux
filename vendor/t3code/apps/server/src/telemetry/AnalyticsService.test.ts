import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";

import type { ManagedPolicyDocument } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { getTelemetryIdentity } from "./Identify.ts";
import * as AnalyticsService from "./AnalyticsService.ts";

const makeRecordingRuntime = (options?: {
  readonly env?: Readonly<Record<string, unknown>>;
  readonly hostEnv?: NodeJS.ProcessEnv;
  readonly policy?: ManagedPolicyDocument;
}) => {
  const requests: Array<{ readonly url: string; readonly method: string }> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({ url: request.url, method: request.method });
      return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
    }),
  );

  const layer = AnalyticsService.layer.pipe(
    Layer.provideMerge(
      ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "prismux-telemetry-hardened-" }),
    ),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(options?.env ?? {}))),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HostProcess.Platform, "win32"),
        Layer.succeed(HostProcess.Architecture, "x64"),
        Layer.succeed(HostProcess.Environment, options?.hostEnv ?? {}),
        Layer.succeed(HttpClient.HttpClient, client),
        ManagedPolicy.layerTest(options?.policy),
      ),
    ),
  );

  return { requests, layer };
};

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "AnalyticsService (Prismux privacy hardening)",
  (it) => {
    it.effect("performs zero HTTP requests and writes no anonymous-id file by default", () =>
      Effect.gen(function* () {
        assert.isTrue(AnalyticsService.PRISMUX_TELEMETRY_HARD_DISABLED);
        const { requests, layer } = makeRecordingRuntime();

        yield* Effect.gen(function* () {
          const config = yield* ServerConfig.ServerConfig;
          const fileSystem = yield* FileSystem.FileSystem;
          const analytics = yield* AnalyticsService.AnalyticsService;
          const identity = yield* getTelemetryIdentity;

          assert.deepEqual(identity, { distinctId: null, installId: null });
          yield* analytics.record("server.boot.heartbeat", { threadCount: 5, projectCount: 2 });
          yield* analytics.recordOwners(
            [{ source: "openai", ownerId: "a".repeat(64) }],
            "server",
          );
          yield* analytics.flush;
          yield* TestClock.adjust("2 minutes");

          assert.isFalse(yield* fileSystem.exists(config.anonymousIdPath));
        }).pipe(Effect.provide(layer));

        assert.deepEqual(requests, []);
      }),
    );

    it.effect(
      "performs zero HTTP requests even when legacy T3CODE_TELEMETRY_ENABLED=true, PostHog host/key, and permissive managed policy are set",
      () =>
        Effect.gen(function* () {
          const { requests, layer } = makeRecordingRuntime({
            env: {
              T3CODE_TELEMETRY_ENABLED: true,
              T3CODE_POSTHOG_KEY: "phc_legacy_test_key",
              T3CODE_POSTHOG_HOST: "https://ingest.t3.codes",
              T3CODE_TELEMETRY_FLUSH_BATCH_SIZE: 1,
            },
            hostEnv: {
              T3CODE_TELEMETRY_ENABLED: "true",
            },
            policy: {
              schemaVersion: 1,
              organization: "Example Corp",
              limits: { telemetry: true },
            },
          });

          yield* Effect.gen(function* () {
            const analytics = yield* AnalyticsService.AnalyticsService;
            for (let index = 0; index < 25; index += 1) {
              yield* analytics.record("provider.turn.completed", { index });
            }
            yield* analytics.recordOwners(
              [
                { source: "connect", ownerId: "b".repeat(64) },
                { source: "claude", ownerId: "c".repeat(64) },
                { source: "device", ownerId: "d".repeat(64) },
              ],
              "client",
            );
            yield* analytics.flush;
            yield* TestClock.adjust("5 minutes");
          }).pipe(Effect.provide(layer));

          assert.deepEqual(requests, []);
        }),
    );
  },
);
