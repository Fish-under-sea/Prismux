import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  __freshSessionArmsTesting,
  armFreshSession,
  disarmFreshSession,
  FRESH_SESSION_ARM_TTL_MS,
  MAX_FRESH_SESSION_ARMS,
  pruneFreshSessionArms,
  readFreshSessionArm,
} from "./freshSessionArms";

describe("freshSessionArms bounded storage and pruning", () => {
  afterEach(() => {
    __freshSessionArmsTesting.resetForTests();
  });

  it("caps armed threads at MAX_FRESH_SESSION_ARMS keeping the newest arms", () => {
    const baseTime = 1_700_000_000_000;
    for (let i = 0; i < MAX_FRESH_SESSION_ARMS + 15; i += 1) {
      armFreshSession(`thread-${i}`, baseTime + i);
    }

    expect(__freshSessionArmsTesting.getArmedCount()).toBe(MAX_FRESH_SESSION_ARMS);
    expect(readFreshSessionArm("thread-0")).toBeUndefined();
    expect(readFreshSessionArm("thread-14")).toBeUndefined();
    expect(readFreshSessionArm("thread-15")).toBe(baseTime + 15);
    expect(readFreshSessionArm(`thread-${MAX_FRESH_SESSION_ARMS + 14}`)).toBe(
      baseTime + MAX_FRESH_SESSION_ARMS + 14,
    );
  });

  it("prunes expired arms and deleted threads", () => {
    const baseTime = 1_700_000_000_000;
    armFreshSession("stale-thread", baseTime);
    armFreshSession("deleted-thread", baseTime + FRESH_SESSION_ARM_TTL_MS);
    armFreshSession("active-thread", baseTime + FRESH_SESSION_ARM_TTL_MS + 10);

    // Arming after TTL automatically drops stale entries.
    expect(readFreshSessionArm("stale-thread")).toBeUndefined();
    expect(readFreshSessionArm("deleted-thread")).toBeDefined();
    expect(readFreshSessionArm("active-thread")).toBeDefined();

    pruneFreshSessionArms(new Set(["active-thread"]), baseTime + FRESH_SESSION_ARM_TTL_MS + 20);
    expect(readFreshSessionArm("deleted-thread")).toBeUndefined();
    expect(readFreshSessionArm("active-thread")).toBeDefined();

    disarmFreshSession("active-thread");
    expect(__freshSessionArmsTesting.getArmedCount()).toBe(0);
  });
});
