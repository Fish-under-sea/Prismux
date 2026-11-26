import {
  UsageDay,
  type EnvironmentId,
  type UsageSummary,
  type UsageSummaryInput,
} from "@prismux/core-contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mockAnsweredEnvironments = [
  {
    environmentId: "env-local" as EnvironmentId,
    label: "Local",
    isPending: false,
    canReadDiagnostics: true,
    isConnected: true,
    error: null,
    summary: {
      contractVersion: 1,
      sinceDay: "2026-11-01",
      untilDay: "2026-11-30",
      timeZone: "UTC",
      resolution: "day",
      buckets: [],
      sources: [],
      totals: {
        totalTokens: 120_000,
        inputTokens: 100_000,
        cachedInputTokens: 80_000,
        cacheCreationTokens: 0,
        outputTokens: 20_000,
        costUsd: 0.42,
      },
    } as unknown as UsageSummary,
  },
] as const;

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => mockAnsweredEnvironments,
}));

// Import after vi.mock so `useUsage` reads our answered environment list.
import { useUsage } from "./usage";

describe("useUsage render-phase window equality (Defect 2.4)", () => {
  it("compares lastAnswered by windowKey value rather than input object identity", async () => {
    // React's server renderer executes render-phase setState retries synchronously until stable
    // (or throws "Too many re-renders" after 25 iterations). Passing a fresh object literal on
    // every call exercises the exact `answeredCount > 0` render-phase guard!
    const onRender = vi.fn();

    function Probe({ recordRender }: { readonly recordRender: () => void }) {
      recordRender();
      const freshWindow: UsageSummaryInput = {
        sinceDay: UsageDay.make("2026-11-01"),
        untilDay: UsageDay.make("2026-11-30"),
        timeZone: "UTC",
        resolution: "day",
      };
      const view = useUsage(freshWindow);
      return createElement(
        "span",
        { "data-has-shown": view.shown ? "yes" : "no" },
        view.environments.length,
      );
    }

    const html = renderToStaticMarkup(createElement(Probe, { recordRender: onRender }));
    expect(html).toContain('data-has-shown="yes"');
    // 1 initial render + at most 1 render-phase setLastAnswered sync = 2 renders (never 25+ loop!).
    expect(onRender.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
