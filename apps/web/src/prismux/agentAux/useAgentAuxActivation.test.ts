import { describe, expect, it } from "vite-plus/test";

import {
  AGENT_AUX_POLL_INTERVAL_MS,
  isAgentAuxThreadActivelyRunning,
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

    expect(
      isAgentAuxThreadActivelyRunning(
        { thread: { status: "running" } },
        undefined,
      ),
    ).toBe(true);

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
      isAgentAuxThreadActivelyRunning(
        { thread: { status: "idle" } },
        [{ latestRun: { status: "in_progress" } } as never],
      ),
    ).toBe(true);
  });
});
