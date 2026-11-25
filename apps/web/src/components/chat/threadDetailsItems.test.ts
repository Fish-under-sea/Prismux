import { describe, expect, it } from "vite-plus/test";

import {
  isDefaultThreadDetailsVisibility,
  resolveThreadDetailsVisibility,
  setThreadDetailsItem,
  THREAD_DETAILS_ITEMS,
} from "./threadDetailsItems";

const usage = THREAD_DETAILS_ITEMS.find((item) => item.id === "usage")!;
const context = THREAD_DETAILS_ITEMS.find((item) => item.id === "context")!;
const servers = THREAD_DETAILS_ITEMS.find((item) => item.id === "servers")!;

describe("thread details items", () => {
  it("enables all 12 thread detail items (including Usage limits and Context window) by default", () => {
    expect(THREAD_DETAILS_ITEMS).toHaveLength(12);
    expect(THREAD_DETAILS_ITEMS.every((item) => item.defaultVisible)).toBe(true);

    const visibility = resolveThreadDetailsVisibility({
      threadDetailsItems: {},
      threadDetailsUsageEnabled: false,
    });
    expect(Object.values(visibility).every(Boolean)).toBe(true);
    expect(visibility.usage).toBe(true);
    expect(visibility.context).toBe(true);
    expect(isDefaultThreadDetailsVisibility(visibility)).toBe(true);
  });

  it.each([
    { legacy: false, items: {}, usage: true, context: true },
    { legacy: true, items: {}, usage: true, context: true },
    { legacy: true, items: { usage: false }, usage: false, context: true },
    { legacy: false, items: { usage: false, context: false, retired: false }, usage: false, context: false },
  ])("resolves Usage and Context defaults and explicit overrides: %o", (row) => {
    const visibility = resolveThreadDetailsVisibility({
      threadDetailsItems: row.items,
      threadDetailsUsageEnabled: row.legacy,
    });
    expect(visibility.usage).toBe(row.usage);
    expect(visibility.context).toBe(row.context);
    expect(visibility.servers).toBe(true);
  });

  it("stores only choices that differ from the enabled default", () => {
    const defaults = { threadDetailsItems: {}, threadDetailsUsageEnabled: false };
    expect(setThreadDetailsItem(defaults, usage, false)).toEqual({ usage: false });
    expect(setThreadDetailsItem(defaults, usage, true)).toEqual({});
    expect(setThreadDetailsItem(defaults, context, false)).toEqual({ context: false });

    const hidden = { threadDetailsItems: { servers: false }, threadDetailsUsageEnabled: false };
    expect(setThreadDetailsItem(hidden, servers, true)).toEqual({});
  });
});
