import {
  ServerNpmReleaseError,
  ServerNpmReleaseInput,
  type ServerNpmRelease,
} from "@prismux/core-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const decodeInput = Schema.decodeUnknownEffect(ServerNpmReleaseInput);

export class NpmRelease extends Context.Service<
  NpmRelease,
  {
    readonly get: (
      input: ServerNpmReleaseInput,
    ) => Effect.Effect<ServerNpmRelease | null, ServerNpmReleaseError>;
  }
>()("@prismux/server/cloud/npmRelease") {}

/**
 * Pure-local zero-telemetry implementation: Prismux manages updates through its own
 * daemon updater and never queries legacy upstream `t3` npm package metadata.
 */
export const make = () =>
  Effect.succeed(
    NpmRelease.of({
      get: Effect.fn("NpmRelease.get")(function* (input) {
        yield* decodeInput(input).pipe(
          Effect.mapError(
            () => new ServerNpmReleaseError({ reason: "Invalid release version or track." }),
          ),
        );
        return null;
      }),
    }),
  );

export const layer = Layer.effect(NpmRelease, make());
