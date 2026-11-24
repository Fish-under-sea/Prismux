import { describe, expect, it } from "@effect/vitest";

import {
  computeUsageCacheHitRate,
  computeUsageOutputTps,
  resolveModelAliases,
  UsageAggregator,
} from "./usageAggregation.ts";
import type { RateTable } from "./usagePricing.ts";
import type { UsageRecord } from "@t3tools/provider-core/server/usage";

const rates: RateTable = new Map([
  [
    "claude-fable-5",
    {
      inputCostPerToken: 1e-5,
      outputCostPerToken: 5e-5,
      cacheReadCostPerToken: 1e-6,
      cacheCreationCostPerToken: 1.25e-5,
      cacheCreation1hCostPerToken: 2e-5,
      fast: {
        inputCostPerToken: 2e-5,
        outputCostPerToken: 1e-4,
        cacheReadCostPerToken: 2e-6,
        cacheCreationCostPerToken: 2.5e-5,
        cacheCreation1hCostPerToken: 4e-5,
      },
      ultrafast: null,
      contextTiers: [],
    },
  ],
]);

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "claude",
    timestampMs: Date.parse("2026-08-07T04:05:13.944Z"),
    model: "claude-fable-5",
    sessionId: "session-a",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    reportedCostUsd: null,
    speed: "standard",
    dedupeKey: null,
    ...overrides,
  };
}

function aggregate(
  records: readonly UsageRecord[],
  timeZone = "UTC",
  resolution: "day" | "hour" = "day",
) {
  const hourlyBounds =
    resolution === "hour"
      ? {
          sinceTimeMs: Date.parse("2026-08-06T04:37:00.000Z"),
          untilTimeMs: Date.parse("2026-08-07T04:37:00.000Z"),
        }
      : {};
  const aggregator = new UsageAggregator({
    timeZone,
    sinceDay: "2026-08-01",
    untilDay: "2026-08-31",
    resolution,
    ...hourlyBounds,
    rates,
  });
  for (const item of records) aggregator.add(item);
  return aggregator.finish();
}

describe("UsageAggregator", () => {
  it("splits a bucket's cost by category and speed", () => {
    const [bucket] = aggregate([record(), record({ speed: "fast" })]).buckets;

    expect(bucket).toMatchObject({
      costUsd: expect.closeTo(0.016875),
      categoryCostUsd: {
        input: expect.closeTo(0.003),
        cacheRead: expect.closeTo(0.003),
        cacheWrite: expect.closeTo(0.000375),
        output: expect.closeTo(0.0075),
      },
      fastCostUsd: expect.closeTo(0.01125),
      speedPremiumUsd: expect.closeTo(0.005625),
    });
    expect(bucket).not.toHaveProperty("ultrafastCostUsd");
  });

  it("merges partial copies of a key by channel maximum in the first copy's bucket", () => {
    const zeroTotals = {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    };
    const partial = record({
      dedupeKey: "msg_1:",
      speed: "fast",
      reportedCostUsd: 1,
      totals: { ...record().totals, cachedInputTokens: 1200, outputTokens: 3, reasoningTokens: 5 },
    });
    const complete = record({
      dedupeKey: "msg_1:",
      model: "claude-fable-5[1m]",
      timestampMs: Date.parse("2026-08-08T12:00:00Z"),
      sessionId: "session-fork",
      reportedCostUsd: 2,
      totals: {
        uncachedInputTokens: 2,
        cachedInputTokens: 1000,
        cacheCreationTokens: 40,
        outputTokens: 264,
        reasoningTokens: 135,
      },
    });
    const zero = { ...partial, totals: zeroTotals, reportedCostUsd: null };
    const merged = {
      reportedCostUsd: 2,
      totals: { ...complete.totals, uncachedInputTokens: 100, cachedInputTokens: 1200 },
    };

    for (const copies of [
      [zero, partial, complete, complete],
      [complete, partial, zero, zero],
    ]) {
      const aggregator = new UsageAggregator({
        timeZone: "UTC",
        sinceDay: "2026-08-01",
        untilDay: "2026-08-31",
        rates,
      });
      copies.forEach((copy, index) => aggregator.add(copy, `${index}.jsonl`));
      const result = aggregator.finish();
      const expected = aggregate([{ ...copies[0]!, ...merged }]).buckets[0];

      expect(result.duplicatesDropped).toBe(3);
      expect(result.buckets).toEqual([{ ...expected, sourcePath: "0.jsonl" }]);
    }
  });

  it("keeps a live Grok turn over a saved pre-v17 maximum in either source order", () => {
    const turn = (timestampMs: number, outputTokens: number) =>
      record({
        provider: "grok",
        model: "grok-4.5",
        timestampMs,
        dedupeKey: `s:p:${timestampMs}:grok-4.5`,
        reportedCostUsd: outputTokens / 10,
        totals: { ...record().totals, uncachedInputTokens: 0, outputTokens },
      });
    const first = turn(Date.parse("2026-08-08T10:00:00Z"), 10);
    const resumed = turn(Date.parse("2026-08-08T11:00:00Z"), 20);
    const savedMaximum = { ...first, totals: resumed.totals, reportedCostUsd: 2 };

    const expected = aggregate([first, resumed]).buckets;

    for (const order of [
      [first, resumed, savedMaximum],
      [savedMaximum, first, resumed],
    ]) {
      const result = aggregate(order);
      expect(result.duplicatesDropped).toBe(1);
      expect(result.buckets).toEqual(expected);
    }
  });

  it("does not count a key whose first copy fell outside the window", () => {
    const result = aggregate([
      record({ dedupeKey: "msg_1:", timestampMs: Date.parse("2026-07-01T12:00:00Z") }),
      record({ dedupeKey: "msg_1:", totals: { ...record().totals, outputTokens: 500 } }),
    ]);

    expect(result.duplicatesDropped).toBe(1);
    expect(result.outOfWindow).toBe(1);
    expect(result.buckets).toHaveLength(0);
  });

  it("buckets by the day in the requested time zone", () => {
    const utc = aggregate([record()], "UTC");
    const losAngeles = aggregate([record()], "America/Los_Angeles");

    expect(utc.buckets[0]?.day).toBe("2026-08-07");
    expect(losAngeles.buckets[0]?.day).toBe("2026-08-06");
  });

  it("finds the day at a quarter-hour zone's midnight across interleaved buckets", () => {
    const result = aggregate(
      [
        record({ timestampMs: Date.parse("2026-08-01T18:14:59.999Z") }),
        record({ timestampMs: Date.parse("2026-08-01T18:15:00.000Z") }),
        record({ timestampMs: Date.parse("2026-08-01T18:15:00.000Z"), model: "claude-opus-5" }),
        record({ timestampMs: Date.parse("2026-08-01T18:16:00.000Z") }),
      ],
      "Asia/Kathmandu",
    );

    expect(result.buckets.map((bucket) => [bucket.day, bucket.model, bucket.records])).toEqual([
      ["2026-08-01", "claude-fable-5", 1],
      ["2026-08-02", "claude-fable-5", 2],
      ["2026-08-02", "claude-opus-5", 1],
    ]);
  });

  it("finds the day at a fixed offset's midnight between quarter hours", () => {
    const result = aggregate(
      [
        record({ timestampMs: Date.parse("2026-08-01T23:58:59.999Z") }),
        record({ timestampMs: Date.parse("2026-08-01T23:59:00.000Z") }),
      ],
      "+00:01",
    );

    expect(result.buckets.map((bucket) => [bucket.day, bucket.records])).toEqual([
      ["2026-08-01", 1],
      ["2026-08-02", 1],
    ]);
  });

  it("splits an hourly request into fixed buckets anchored to its exact start", () => {
    const result = aggregate(
      [
        record({ timestampMs: Date.parse("2026-08-07T02:40:13.944Z") }),
        record({ timestampMs: Date.parse("2026-08-07T03:40:13.944Z") }),
      ],
      "America/Los_Angeles",
      "hour",
    );

    expect(result.buckets.map((bucket) => [bucket.day, bucket.hourStart])).toEqual([
      ["2026-08-06", "2026-08-07T02:37:00.000Z"],
      ["2026-08-06", "2026-08-07T03:37:00.000Z"],
    ]);
  });

  it("uses an inclusive start and exclusive end for rolling windows", () => {
    const result = aggregate(
      [
        record({ timestampMs: Date.parse("2026-08-06T04:36:59.999Z") }),
        record({ timestampMs: Date.parse("2026-08-06T04:37:00.000Z") }),
        record({ timestampMs: Date.parse("2026-08-07T04:36:59.999Z") }),
        record({ timestampMs: Date.parse("2026-08-07T04:37:00.000Z") }),
      ],
      "UTC",
      "hour",
    );

    expect(result.outOfWindow).toBe(2);
    expect(result.buckets.map((bucket) => bucket.hourStart)).toEqual([
      "2026-08-06T04:37:00.000Z",
      "2026-08-07T03:37:00.000Z",
    ]);
  });

  it("counts tokens but not cost for a model with no rate", () => {
    const result = aggregate([record({ model: "kimi-k3" })]);

    expect(result.buckets[0]?.costUsd).toBe(0);
    expect(result.buckets[0]?.costSource).toBe("unpriced");
    expect(result.buckets[0]?.unpricedRecords).toBe(1);
    expect(result.buckets[0]?.totals.outputTokens).toBe(50);
  });

  it("prefers a reported cost over the rate table", () => {
    const result = aggregate([record({ reportedCostUsd: 1.25 })]);

    expect(result.buckets[0]?.costUsd).toBe(1.25);
    expect(result.buckets[0]?.costSource).toBe("providerReported");
  });

  it("folds a mapped model into its target and prices it there", () => {
    const aggregator = new UsageAggregator({
      timeZone: "UTC",
      sinceDay: "2026-08-01",
      untilDay: "2026-08-31",
      rates,
      modelAliases: resolveModelAliases({ "example-preview": "claude-fable-5" }),
      rateModel: () => "claude-fable",
    });
    aggregator.add(record());
    aggregator.add(record({ model: "example-preview", rateModel: "example-preview-high" }));
    const result = aggregator.finish();

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0]?.model).toBe("claude-fable-5");
    expect(result.buckets[0]?.records).toBe(2);
    expect(result.buckets[0]?.costUsd).toBeCloseTo(0.00925, 9);
    expect(result.buckets[0]?.unpricedRecords).toBe(0);
  });
});

describe("resolveModelAliases", () => {
  it("follows chains to the final model and drops chains that enter a loop", () => {
    expect([
      ...resolveModelAliases({
        "preview[1m]": "preview",
        preview: "example-model",
        shared: "preview",
        intoLoop: "loop",
        loop: "back",
        back: "loop",
        laterIntoLoop: "back",
        deepIntoLoop: "intoLoop",
        self: "self",
        validAfterLoops: "shared",
      }),
    ]).toEqual([
      ["preview[1m]", "example-model"],
      ["preview", "example-model"],
      ["shared", "example-model"],
      ["validAfterLoops", "example-model"],
    ]);
  });
});

describe("UsageCallLog aggregation and telemetry math", () => {
  it("computes real cache hit rate and output TPS without fabricating missing timings", () => {
    expect(computeUsageCacheHitRate(100, 900, 0)).toBe(0.9);
    expect(computeUsageCacheHitRate(100, 800, 100)).toBe(0.8);
    expect(computeUsageCacheHitRate(0, 0, 0)).toBeNull();

    // Post-TTFT generation window when durationMs > ttftMs
    expect(computeUsageOutputTps(100, 2500, 500)).toBe(50);
    // Total duration fallback when ttftMs is absent
    expect(computeUsageOutputTps(100, 2000, null)).toBe(50);
    // Strictly null when real timing or output tokens are missing
    expect(computeUsageOutputTps(100, null, null)).toBeNull();
    expect(computeUsageOutputTps(100, 0, null)).toBeNull();
    expect(computeUsageOutputTps(0, 2000, 200)).toBeNull();
    // Sub-10ms noise rejected; buffered single-packet micro-bursts fall back to total duration
    expect(computeUsageOutputTps(50, 5, null)).toBeNull();
    expect(computeUsageOutputTps(73, 26_125, 26_124)).toBeCloseTo(2.79, 2);
    expect(computeUsageOutputTps(2081, 26_182, 25_425)).toBeCloseTo(79.48, 2);
    // Normal streaming post-TTFT throughput stays exact
    expect(computeUsageOutputTps(1356, 17_070, 7_728)).toBeCloseTo(145.15, 2);
  });

  it("preserves ttftMs and max durationMs across merged UsageRecord copies", () => {
    const t = Date.parse("2026-08-07T04:05:10.000Z");
    const result = aggregate([
      record({
        timestampMs: t,
        dedupeKey: "msg_timed",
        durationMs: 2_400,
        totals: {
          uncachedInputTokens: 100,
          cachedInputTokens: 900,
          cacheCreationTokens: 0,
          outputTokens: 20,
          reasoningTokens: 0,
        },
      }),
      record({
        timestampMs: t,
        dedupeKey: "msg_timed",
        ttftMs: 400,
        durationMs: 2_600,
        totals: {
          uncachedInputTokens: 100,
          cachedInputTokens: 900,
          cacheCreationTokens: 0,
          outputTokens: 220,
          reasoningTokens: 0,
        },
      }),
    ]);
    expect(result.callLogs).toHaveLength(1);
    expect(result.callLogs[0]).toMatchObject({
      ttftMs: 400,
      durationMs: 2_600,
      tps: 100,
    });
  });

  it("emits deduplicated, newest-first bounded callLogs with null timings when transcripts lack them", () => {
    const aggregator = new UsageAggregator({
      timeZone: "UTC",
      sinceDay: "2026-08-01",
      untilDay: "2026-08-31",
      rates,
      maxCallLogs: 2,
    });
    const t1 = Date.parse("2026-08-07T04:05:10.000Z");
    const t2 = Date.parse("2026-08-07T04:06:10.000Z");
    const t3 = Date.parse("2026-08-07T04:07:10.000Z");

    aggregator.add(record({ timestampMs: t1, sessionId: "", dedupeKey: null }));
    // Partial copy + completed copy sharing dedupeKey collapse into one merged callLog entry
    aggregator.add(
      record({
        timestampMs: t2,
        sessionId: "thread-2",
        dedupeKey: "msg_2",
        totals: {
          uncachedInputTokens: 100,
          cachedInputTokens: 800,
          cacheCreationTokens: 100,
          outputTokens: 10,
          reasoningTokens: 0,
        },
      }),
      undefined,
      { ttftMs: 400, durationMs: 2400 },
    );
    aggregator.add(
      record({
        timestampMs: t2,
        sessionId: "thread-2",
        dedupeKey: "msg_2",
        totals: {
          uncachedInputTokens: 100,
          cachedInputTokens: 800,
          cacheCreationTokens: 100,
          outputTokens: 100,
          reasoningTokens: 0,
        },
      }),
    );
    aggregator.add(
      record({
        timestampMs: t3,
        sessionId: "thread-3",
        dedupeKey: null,
        speed: "fast",
        totals: {
          uncachedInputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
          outputTokens: 40,
          reasoningTokens: 0,
        },
      }),
    );

    const { callLogs } = aggregator.finish();
    expect(callLogs).toHaveLength(2);
    // Newest first (t3, then t2; t1 evicted by maxCallLogs: 2)
    expect(callLogs[0]).toMatchObject({
      timestamp: "2026-08-07T04:07:10.000Z",
      provider: "claude",
      model: "claude-fable-5",
      threadId: "thread-3",
      ttftMs: null,
      durationMs: null,
      tps: null,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 40,
      cacheHitRate: null,
      speed: "fast",
    });
    expect(callLogs[1]).toMatchObject({
      id: "claude:msg_2",
      timestamp: "2026-08-07T04:06:10.000Z",
      provider: "claude",
      model: "claude-fable-5",
      threadId: "thread-2",
      ttftMs: 400,
      durationMs: 2400,
      tps: 50,
      inputTokens: 100,
      cachedInputTokens: 800,
      cacheCreationTokens: 100,
      outputTokens: 100,
      cacheHitRate: 0.8,
      speed: "standard",
    });
  });

  it("omits threadId when sessionId is blank", () => {
    const { callLogs } = aggregate([record({ sessionId: "   " })]);
    expect(callLogs).toHaveLength(1);
    expect(callLogs[0]).not.toHaveProperty("threadId");
    expect(callLogs[0]?.ttftMs).toBeNull();
    expect(callLogs[0]?.durationMs).toBeNull();
    expect(callLogs[0]?.tps).toBeNull();
    expect(callLogs[0]?.cacheHitRate).toBeCloseTo(1000 / 1110, 4);
  });
});
