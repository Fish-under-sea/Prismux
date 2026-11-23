import type { AntigravitySettings } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { makeUnavailableUsageLimits } from "@t3tools/provider-core/server/usageLimits";

/**
 * Official Antigravity ACP (`agy acp`) exposes account tier (`_meta.antigravity.tier`) and
 * per-session context usage (`usage_update`), but does not expose account quota windows or AI
 * Credits balances. To stay 100% compliant with official ACP and avoid reading local OAuth tokens
 * or calling undocumented external private vendor endpoints with forged client headers,
 * Prismux never probes Antigravity quotas out-of-band.
 */
export const ANTIGRAVITY_ACP_QUOTA_UNSUPPORTED_MESSAGE =
  "Antigravity ACP does not expose quota or credit balances. Run 'agy' and use /usage or /credits in a terminal.";

export const makeAntigravityUsageProbe = Effect.fn("makeAntigravityUsageProbe")(function* (_input: {
  readonly profileDirectory: string;
  readonly userHome?: string;
  readonly authMethod: AntigravitySettings["authMethod"];
}) {
  const probe = Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return makeUnavailableUsageLimits({
      checkedAt,
      reason: "unsupported",
      message: ANTIGRAVITY_ACP_QUOTA_UNSUPPORTED_MESSAGE,
    });
  });
  return {
    probe,
    clear: Effect.void,
  };
});
