import { expect, it } from "@effect/vitest";
import { ServerNpmReleaseError } from "@prismux/core-contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import * as NpmRelease from "./npmRelease.ts";

it.effect.each(["latest", "nightly", "0.2.2-rc.2"] as const)(
  "returns null for valid release spec %s without querying legacy upstream t3 npm registry",
  (spec) =>
    Effect.gen(function* () {
      const service = yield* NpmRelease.make();
      expect(yield* service.get({ spec })).toBeNull();
    }),
);

it.effect.each(["--registry=https://example.com", "../other", "other-package@latest", "*", ""])(
  "rejects invalid release specs with ServerNpmReleaseError: %s",
  (spec) =>
    Effect.gen(function* () {
      const service = yield* NpmRelease.make();
      const result = yield* service.get({ spec }).pipe(Effect.result);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(ServerNpmReleaseError);
      }
    }),
);
