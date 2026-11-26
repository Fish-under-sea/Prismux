import type { EnvironmentId, UsageModelFilter, UsageSummaryInput } from "@prismux/core-contracts";
import * as Schema from "effect/Schema";
import type { AtomRegistry } from "effect/reactivity";

import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import type { createEnvironmentPresentationAtoms } from "./presentation.ts";
import { executeAtomQuery, runAtomCommand, squashAtomCommandFailure } from "./runtime.ts";
import type { createServerEnvironmentAtoms } from "./server.ts";

const isEnvironmentRpcUnavailable = Schema.is(EnvironmentRpcUnavailableError);

export type UsagePricingRefreshMode = "await" | "background" | "skip";

/** Normalize usage summary input keys so query atoms and manual refresh target the exact same key. */
export function normalizeUsageSummaryInput(input: UsageSummaryInput): UsageSummaryInput {
  return {
    sinceDay: input.sinceDay,
    untilDay: input.untilDay,
    timeZone: input.timeZone,
    ...(input.resolution !== undefined ? { resolution: input.resolution } : {}),
    ...(input.sinceTime !== undefined ? { sinceTime: input.sinceTime } : {}),
    ...(input.untilTime !== undefined ? { untilTime: input.untilTime } : {}),
    ...(input.modelFilter !== undefined ? { modelFilter: input.modelFilter } : {}),
  };
}

/** The Usage tab asks each environment with that environment's configured model filter. */
export function usageSummaryInput(
  input: UsageSummaryInput,
  modelFilter: UsageModelFilter | undefined,
): UsageSummaryInput {
  const normalized = normalizeUsageSummaryInput(input);
  return modelFilter === undefined ? normalized : { ...normalized, modelFilter };
}

const limitsRefreshAfter = new Map<EnvironmentId, number>();
const limitsRefreshes = new Map<EnvironmentId, Promise<unknown>>();

export async function refreshUsageLimits<A>(
  environmentId: EnvironmentId,
  refresh: () => Promise<A>,
  automatic = false,
): Promise<A | undefined> {
  const pending = limitsRefreshes.get(environmentId);
  if (pending !== undefined) {
    return automatic ? undefined : ((await pending) as A);
  }
  const refreshAfter = limitsRefreshAfter.get(environmentId) ?? 0;
  // @effect-diagnostics-next-line globalDate:off
  if (automatic && Date.now() < refreshAfter) return;
  const current = Promise.resolve()
    .then(refresh)
    .finally(() => {
      limitsRefreshes.delete(environmentId);
      // @effect-diagnostics-next-line globalDate:off
      limitsRefreshAfter.set(environmentId, Date.now() + 5 * 60_000);
    });
  limitsRefreshes.set(environmentId, current);
  return await current;
}

export async function refreshUsage({
  registry,
  server,
  presentations,
  environmentIds,
  input,
  pricingRefreshMode = "await",
}: {
  registry: AtomRegistry.AtomRegistry;
  server: Pick<
    ReturnType<typeof createServerEnvironmentAtoms>,
    "usageSummary" | "refreshUsageRates" | "usageModelFilterAtom"
  >;
  presentations: Pick<ReturnType<typeof createEnvironmentPresentationAtoms>, "presentationAtom">;
  environmentIds: readonly EnvironmentId[];
  input: UsageSummaryInput;
  /**
   * Controls how pricing-rate refresh interacts with transcript rescanning:
   * - `"await"` (default): wait for `refreshUsageRates` before rescanning (Usage page).
   * - `"background"`: fire `refreshUsageRates` non-blockingly and rescan local transcripts immediately.
   * - `"skip"`: rescan local transcripts immediately without touching external pricing endpoints.
   */
  pricingRefreshMode?: UsagePricingRefreshMode;
}): Promise<void> {
  await Promise.all(
    environmentIds.map(async (environmentId) => {
      const query = server.usageSummary({
        environmentId,
        input: usageSummaryInput(input, registry.get(server.usageModelFilterAtom(environmentId))),
      });
      const presentation = presentations.presentationAtom(environmentId);
      const controller = new AbortController();
      const abortWhenDisconnected = () => {
        if (registry.get(presentation)?.connection.phase !== "connected") controller.abort();
      };
      const unsubscribe = registry.subscribe(presentation, abortWhenDisconnected);
      abortWhenDisconnected();
      try {
        let sessionUnavailable = false;
        if (pricingRefreshMode === "await") {
          const ratesResult = await runAtomCommand(
            registry,
            server.refreshUsageRates,
            { environmentId, input: {} },
            { reportFailure: false },
          );
          sessionUnavailable =
            ratesResult._tag === "Failure" &&
            isEnvironmentRpcUnavailable(squashAtomCommandFailure(ratesResult));
        } else if (pricingRefreshMode === "background") {
          void runAtomCommand(
            registry,
            server.refreshUsageRates,
            { environmentId, input: {} },
            { reportFailure: false },
          ).catch(() => {});
        }
        registry.refresh(query);
        if (sessionUnavailable || controller.signal.aborted) return;
        await executeAtomQuery(registry, query, {
          reportFailure: false,
          signal: controller.signal,
        });
      } finally {
        unsubscribe();
      }
    }),
  );
}
