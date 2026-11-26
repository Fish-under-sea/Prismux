import type { ThreadId } from "@prismux/core-contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  AGENT_AUX_POLL_INTERVAL_MS,
  extractSwarmSignalsFromProjection,
  getAutoOpenedActivationKeyCountForTest,
  hasAutoOpenedActivationKeyForTest,
  isAgentAuxThreadActivelyRunning,
  MAX_AUTO_OPENED_ACTIVATION_KEYS,
  recordAutoOpenedActivationKey,
  resetAgentAuxAutoOpenMemoryForTest,
} from "./useAgentAuxActivation";

describe("useAgentAuxActivation polling gate & real OrchestrationV2 projection detection", () => {
  it("uses >= 12s fallback polling interval (exceeding Daemon roster TTL)", () => {
    expect(AGENT_AUX_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(12_000);
  });

  it("detects active execution from real OrchestrationV2ThreadProjection (runs/attempts/providerTurns/turnItems) and threadShell", () => {
    expect(isAgentAuxThreadActivelyRunning(null, undefined, null)).toBe(false);
    expect(
      isAgentAuxThreadActivelyRunning(
        {
          runs: [{ id: "r1", status: "completed" }],
          attempts: [{ id: "a1", status: "completed" }],
          providerTurns: [{ id: "t1", status: "completed" }],
          turnItems: [{ id: "i1", type: "agent_message", status: "completed" }],
          subagents: [{ status: "completed" } as never],
        },
        [{ runtime: { status: "completed" } } as never],
        {
          id: "thread-1" as ThreadId,
          status: "idle",
          activityRunStatus: "completed",
          activeRunId: null,
          lineage: {},
        },
      ),
    ).toBe(false);

    // Active via real threadShell.activeRunId
    expect(
      isAgentAuxThreadActivelyRunning(null, undefined, {
        id: "thread-1" as ThreadId,
        activeRunId: "run-live-1",
        lineage: {},
      }),
    ).toBe(true);

    // Active via real threadShell.activityRunStatus
    expect(
      isAgentAuxThreadActivelyRunning(null, undefined, {
        id: "thread-1" as ThreadId,
        activityRunStatus: "running",
        lineage: {},
      }),
    ).toBe(true);

    // Active via real projection.runs
    expect(
      isAgentAuxThreadActivelyRunning({
        runs: [{ id: "r1", status: "running" }],
      }),
    ).toBe(true);

    // Active via real projection.attempts
    expect(
      isAgentAuxThreadActivelyRunning({
        attempts: [{ id: "a1", status: "streaming" }],
      }),
    ).toBe(true);

    // Active via real projection.providerTurns
    expect(
      isAgentAuxThreadActivelyRunning({
        providerTurns: [{ id: "t1", status: "in_progress" }],
      }),
    ).toBe(true);

    // Active via real projection.turnItems (tail item in_progress)
    expect(
      isAgentAuxThreadActivelyRunning({
        turnItems: [{ id: "ti-1", type: "dynamic_tool", status: "in_progress" }],
      }),
    ).toBe(true);

    // Backward-compatible legacy checks still work
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

  it("extracts AGY /swarm tool signals and Windows/POSIX antigravity-cli brain UUID fallback from projection.turnItems", () => {
    const empty = extractSwarmSignalsFromProjection(null);
    expect(empty).toEqual({ swarmSignalCount: 0, extractedBrainConvId: null });

    const convUuid = "4c8c90f6-37d8-4a0d-b9b2-8f65d1e51a2b";
    const signals = extractSwarmSignalsFromProjection({
      turnItems: [
        {
          type: "dynamic_tool",
          toolName: "swarm",
          input: { action: "title", title: "Wave 2" },
        },
        {
          type: "dynamic_tool",
          toolName: "post_message",
          input: { text: "@worker-1 start" },
        },
        {
          type: "file_change",
          fileName: `C:\\Users\\Fish\\.gemini\\antigravity-cli\\brain\\${convUuid}\\.system_generated\\swarm\\plan.json`,
        },
        {
          type: "dynamic_tool",
          toolName: "swarm_wait",
          input: { since: 1 },
        },
      ],
    });

    expect(signals.swarmSignalCount).toBe(4);
    expect(signals.extractedBrainConvId).toBe(convUuid);

    // Also detects POSIX path embedded inside tool output / agent_message text
    const convUuid2 = "99112233-4455-6677-8899-aabbccddeeff";
    const posixSignals = extractSwarmSignalsFromProjection({
      turnItems: [
        {
          type: "agent_message",
          text: `Updated /home/user/.gemini/antigravity/brain/${convUuid2}/.system_generated/swarm/members.json`,
        },
      ],
    });
    expect(posixSignals.swarmSignalCount).toBe(1);
    expect(posixSignals.extractedBrainConvId).toBe(convUuid2);
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
