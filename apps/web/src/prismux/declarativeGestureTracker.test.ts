import {
  createDeclarativeGestureTracker,
  DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS,
} from "@prismux/appearance";
import { describe, expect, it } from "vite-plus/test";

describe("createDeclarativeGestureTracker disconnected element cleanup (L13)", () => {
  it("prunes disconnected elements from both placements and attached sets during sample()", () => {
    let now = 1000;
    const tracker = createDeclarativeGestureTracker(() => now);
    const detachedBtn = {
      isConnected: true,
      getBoundingClientRect: () => ({ left: 20, top: 200, width: 100, height: 32 }),
    };

    tracker.track("cb:detached", detachedBtn);
    expect(tracker.isSettled("cb:detached", 1600, DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS)).toBe(
      true,
    );

    // Disconnecting the node and calling sample() must prune it from placements & attached
    detachedBtn.isConnected = false;
    tracker.sample(1700);
    expect(tracker.isSettled("cb:detached", 2400, DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS)).toBe(
      false,
    );

    // Calling track(id, null) on pruned or unknown ids remains a safe no-op
    tracker.track("cb:detached", null);
    tracker.track("cb:never-tracked", null);
    expect(tracker.isSettled("cb:detached", 3000, DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS)).toBe(
      false,
    );

    // Tracking a fresh connected node under the same id starts a clean settle window
    const freshBtn = {
      isConnected: true,
      getBoundingClientRect: () => ({ left: 20, top: 200, width: 100, height: 32 }),
    };
    now = 3000;
    tracker.track("cb:detached", freshBtn);
    expect(tracker.isSettled("cb:detached", 3200, DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS)).toBe(
      false,
    );
    expect(tracker.isSettled("cb:detached", 3600, DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS)).toBe(
      true,
    );
  });
});
