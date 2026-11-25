import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  ANTIGRAVITY_ACP_QUOTA_UNSUPPORTED_MESSAGE,
  makeAntigravityUsageProbe,
} from "./antigravityUsageLimits.ts";

describe("Antigravity pure-ACP usage compliance", () => {
  it.effect(
    "never reads local tokens, OS keyring, or v1internal quota endpoints for local-cli",
    () =>
      Effect.gen(function* () {
        const usage = yield* makeAntigravityUsageProbe({
          profileDirectory: "/nonexistent/profile",
          userHome: "/nonexistent/home",
          authMethod: "local-cli",
        });
        const limits = yield* usage.probe;
        expect(limits.windows).toEqual([]);
        expect(limits.unavailable).toEqual({
          reason: "unsupported",
          message: ANTIGRAVITY_ACP_QUOTA_UNSUPPORTED_MESSAGE,
        });
        expect(limits.credentialFingerprint).toBeUndefined();
        yield* usage.clear;
      }),
  );
});
