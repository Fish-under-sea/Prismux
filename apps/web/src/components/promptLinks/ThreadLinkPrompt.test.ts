import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  __threadLinkPromptTesting,
  markHandledLinkKey,
  MAX_HANDLED_LINK_KEYS,
} from "./ThreadLinkPrompt";

describe("ThreadLinkPrompt handledLinkKeys LRU cap", () => {
  afterEach(() => {
    __threadLinkPromptTesting.resetHandledLinkKeysForTests();
  });

  it("deduplicates repeated keys and caps size at 200 entries with LRU eviction", () => {
    expect(markHandledLinkKey("key-0")).toBe(true);
    expect(markHandledLinkKey("key-0")).toBe(false);

    for (let i = 1; i < MAX_HANDLED_LINK_KEYS; i += 1) {
      expect(markHandledLinkKey(`key-${i}`)).toBe(true);
    }

    // Re-seeing key-0 refreshes its recency so key-1 is evicted first on overflow.
    expect(markHandledLinkKey("key-0")).toBe(false);
    expect(markHandledLinkKey("key-overflow")).toBe(true);

    expect(__threadLinkPromptTesting.getHandledLinkKeyCount()).toBe(MAX_HANDLED_LINK_KEYS);
    expect(__threadLinkPromptTesting.hasHandledLinkKey("key-0")).toBe(true);
    expect(__threadLinkPromptTesting.hasHandledLinkKey("key-1")).toBe(false);
    expect(__threadLinkPromptTesting.hasHandledLinkKey("key-overflow")).toBe(true);
  });
});
