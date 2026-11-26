import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  AGENT_AUX_POLL_INTERVAL_MS,
  getAutoOpenedActivationKeyCountForTest,
  hasAutoOpenedActivationKeyForTest,
  isAgentAuxThreadActivelyRunning,
  MAX_AUTO_OPENED_ACTIVATION_KEYS,
  recordAutoOpenedActivationKey,
  resetAgentAuxAutoOpenMemoryForTest,
} from "./useAgentAuxActivation";

describe("useAgentAuxActivation polling gate", () => {
  it("uses >= 12s polling interval (exceeding Daemon roster TTL)", () => {
    expect(AGENT_AUX_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(12_000);
  });

  it("returns false for idle/completed threads and true only when active thread or child work is running", () => {
    expect(isAgentAuxThreadActivelyRunning(null, undefined)).toBe(false);
    expect(
      isAgentAuxThreadActivelyRunning(
        {
          thread: { status: "idle" },
          subagents: [{ status: "completed" } as never],
        },
        [{ runtime: { status: "completed" } } as never],
      ),
    ).toBe(false);

    expect(isAgentAuxThreadActivelyRunning({ thread: { status: "running" } }, undefined)).toBe(
      true,
    );

    expect(
      isAgentAuxThreadActivelyRunning(
        {
          thread: { status: "idle" },
          subagents: [{ status: "streaming" } as never],
        },
        undefined,
      ),
    ).toBe(true);

    expect(
      isAgentAuxThreadActivelyRunning({ thread: { status: "idle" } }, [
        { latestRun: { status: "in_progress" } } as never,
      ]),
    ).toBe(true);
  });
});

describe("useAgentAuxActivation bounded auto-open memory", () => {
  afterEach(() => {
    resetAgentAuxAutoOpenMemoryForTest();
  });

  it("caps autoOpenedActivationKeys at 200 entries with LRU eviction", () => {
    for (let i = 0; i < MAX_AUTO_OPENED_ACTIVATION_KEYS + 25; i += 1) {
      recordAutoOpenedActivationKey(`thread-${i}:aux`);
    }

    expect(getAutoOpenedActivationKeyCountForTest()).toBe(MAX_AUTO_OPENED_ACTIVATION_KEYS);
    expect(hasAutoOpenedActivationKeyForTest("thread-0:aux")).toBe(false);
    expect(hasAutoOpenedActivationKeyForTest("thread-24:aux")).toBe(false);
    expect(hasAutoOpenedActivationKeyForTest("thread-25:aux")).toBe(true);
    expect(
      hasAutoOpenedActivationKeyForTest(`thread-${MAX_AUTO_OPENED_ACTIVATION_KEYS + 24}:aux`),
    ).toBe(true);
  });
});
