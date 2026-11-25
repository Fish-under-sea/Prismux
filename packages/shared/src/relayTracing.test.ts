import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Tracer from "effect/Tracer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import {
  layer as relayTracingLayer,
  nonInterferingTracer,
  RelayClientTracer,
  withLocalTracing,
  withRelayClientTracing,
} from "./relayTracing.ts";

function collectingTracer(spans: Array<string>): Tracer.Tracer {
  return Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        spans.push(span.name);
      };
      return span;
    },
  });
}

describe("withRelayClientTracing", () => {
  it.effect("uses the product tracer only for relay operations", () =>
    Effect.gen(function* () {
      const userSpans: Array<string> = [];
      const productSpans: Array<string> = [];
      const userTracer = collectingTracer(userSpans);
      const productTracer = collectingTracer(productSpans);

      yield* Effect.void.pipe(Effect.withSpan("user.operation"), Effect.withTracer(userTracer));
      yield* Effect.void.pipe(
        Effect.withSpan("relay.operation"),
        withRelayClientTracing,
        Effect.provideService(RelayClientTracer, Option.some(productTracer)),
        Effect.withTracer(userTracer),
      );

      expect(userSpans).toEqual(["user.operation"]);
      expect(productSpans).toEqual(["relay.operation"]);
    }),
  );
});

describe("nonInterferingTracer", () => {
  it.effect("exports failures without their messages", () =>
    Effect.gen(function* () {
      const exits: Array<Exit.Exit<unknown, unknown>> = [];
      const delegate = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);
          span.end = (endTime, exit) => {
            end(endTime, exit);
            exits.push(exit);
          };
          return span;
        },
      });
      const failure = Object.assign(
        new Error("studio-mac could not establish a WebSocket connection.", {
          cause: new Error("connect ECONNREFUSED studio-mac.local"),
        }),
        { name: "ConnectionTransientError" },
      );

      yield* Effect.fail(failure).pipe(
        Effect.withSpan("relay.connection.attempt"),
        Effect.withTracer(nonInterferingTracer(delegate)),
        Effect.ignore,
      );

      const exit = exits[0];
      if (exit === undefined || !Exit.isFailure(exit)) throw new Error("expected a failed span");
      const exported = Cause.prettyErrors(exit.cause);
      expect(exported.map((error) => error.name)).toEqual(["ConnectionTransientError"]);
      const text = exported.map((error) => `${error.message}\n${error.stack}`).join("\n");
      expect(text).toContain("Caused by: Error");
      expect(text).not.toContain("studio-mac");
    }),
  );
});

describe("withLocalTracing", () => {
  it.effect("keeps local work inside a relay span off the product tracer", () =>
    Effect.gen(function* () {
      const localSpans: Array<string> = [];
      const productSpans: Array<string> = [];
      const localTracer = collectingTracer(localSpans);
      const productTracer = collectingTracer(productSpans);

      yield* Effect.void.pipe(
        Effect.withSpan("relay.connection.nested"),
        Effect.andThen(
          Effect.void.pipe(
            Effect.withSpan("sql.execute"),
            Effect.withSpan("ServerSecretStore.get"),
            withLocalTracing,
          ),
        ),
        Effect.withSpan("environment.orchestration.threadSnapshot"),
        withRelayClientTracing,
        Effect.provideService(RelayClientTracer, Option.some(productTracer)),
        Effect.withTracer(localTracer),
      );

      expect(productSpans).toEqual([
        "relay.connection.nested",
        "environment.orchestration.threadSnapshot",
      ]);
      expect(localSpans).toEqual(["sql.execute", "ServerSecretStore.get"]);
    }),
  );
});

describe("RelayTracing.layer (Prismux hard cutoff)", () => {
  it.effect("never exports spans or issues HTTP requests even with Axiom OTLP credentials", () =>
    Effect.gen(function* () {
      const requests: Array<string> = [];
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(request.url);
          return HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }));
        }),
      );

      const resolvedTracer = yield* RelayClientTracer.pipe(
        Effect.provide(
          relayTracingLayer(
            {
              tracesUrl: "https://api.axiom.co/v1/traces",
              tracesDataset: "prismux-relay",
              tracesToken: "xaat-synthetic-token",
            },
            {
              serviceName: "prismux-test",
              runtime: "node",
              serviceInstanceId: "instance-1",
              client: "desktop",
            },
            { isEnabled: () => true },
          ).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client))),
        ),
      );

      expect(Option.isNone(resolvedTracer)).toBe(true);
      expect(requests).toEqual([]);
    }),
  );
});
