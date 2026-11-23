import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  ANTIGRAVITY_ACP_QUOTA_UNSUPPORTED_MESSAGE,
  makeAntigravityUsageProbe,
} from "./antigravityUsageLimits.ts";

describe("Antigravity pure-ACP usage compliance", () => {
  it.effect(
    "never reads local tokens, OS keyring, or v1internal quota endpoints for any auth method",
    () =>
      Effect.gen(function* () {
        for (const authMethod of [
          "local-cli",
          "oauth-personal",
          "oauth-business",
          "gemini-api-key",
          "agent-platform",
        ] as const) {
          const usage = yield* makeAntigravityUsageProbe({
            profileDirectory: "/nonexistent/profile",
            userHome: "/nonexistent/home",
            authMethod,
          });
          const limits = yield* usage.probe;
          expect(limits.windows).toEqual([]);
          expect(limits.unavailable).toEqual({
            reason: "unsupported",
            message: ANTIGRAVITY_ACP_QUOTA_UNSUPPORTED_MESSAGE,
          });
          expect(limits.credentialFingerprint).toBeUndefined();
          yield* usage.clear;
        }
      }),
  );
});
