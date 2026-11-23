import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_CHIEF_DISPLAY_NAME,
  detectChiefMention,
  isCustomChiefDisplayName,
  normalizeChiefDisplayName,
  stripChiefMentionPrefix,
} from "./chiefMention";

describe("chiefMention custom secretary name recognition", () => {
  it("normalizes custom names and falls back to default 主秘书", () => {
    expect(normalizeChiefDisplayName(undefined)).toBe(DEFAULT_CHIEF_DISPLAY_NAME);
    expect(normalizeChiefDisplayName("   ")).toBe(DEFAULT_CHIEF_DISPLAY_NAME);
    expect(normalizeChiefDisplayName("  猫猫  ")).toBe("猫猫");
    expect(normalizeChiefDisplayName("Aria\n\tPrime")).toBe("Aria Prime");
    expect(isCustomChiefDisplayName(undefined)).toBe(false);
    expect(isCustomChiefDisplayName("主秘书")).toBe(false);
    expect(isCustomChiefDisplayName("小棱")).toBe(true);
  });

  it("matches Chinese & English @mentions and direct call prefixes", () => {
    expect(detectChiefMention("@猫猫 帮我整理今天的会议纪要", "猫猫")).toEqual({
      matched: true,
      kind: "at-mention",
      matchedName: "猫猫",
      strippedText: "帮我整理今天的会议纪要",
    });

    expect(detectChiefMention("猫猫，把昨晚的报错摘要发我", "猫猫")).toEqual({
      matched: true,
      kind: "direct-prefix",
      matchedName: "猫猫",
      strippedText: "把昨晚的报错摘要发我",
    });

    expect(detectChiefMention("小棱：检索记忆库里关于 pnpm 的偏好", "小棱")).toEqual({
      matched: true,
      kind: "direct-prefix",
      matchedName: "小棱",
      strippedText: "检索记忆库里关于 pnpm 的偏好",
    });

    expect(detectChiefMention("aria, review the latest diff", "Aria")).toEqual({
      matched: true,
      kind: "direct-prefix",
      matchedName: "Aria",
      strippedText: "review the latest diff",
    });

    expect(detectChiefMention("@Aria - summarize today's PRs", "Aria")).toEqual({
      matched: true,
      kind: "at-mention",
      matchedName: "Aria",
      strippedText: "summarize today's PRs",
    });

    expect(detectChiefMention("麻烦 @小棱 帮我记住这条规则", "小棱")).toEqual({
      matched: true,
      kind: "at-mention",
      matchedName: "小棱",
      strippedText: "麻烦 @小棱 帮我记住这条规则",
    });

    expect(detectChiefMention("猫猫", "猫猫")).toEqual({
      matched: true,
      kind: "exact",
      matchedName: "猫猫",
      strippedText: "",
    });
  });

  it("avoids false positives on unrelated messages or partial ASCII word matches", () => {
    expect(detectChiefMention("Maria, please check the build", "Aria").matched).toBe(false);
    expect(detectChiefMention("@AriaBot run tests", "Aria").matched).toBe(false);
    expect(detectChiefMention("Ariadne, check this", "Aria").matched).toBe(false);
    expect(detectChiefMention("email@aria.dev is an address", "Aria").matched).toBe(false);
    expect(detectChiefMention("普通聊天消息没有呼叫秘书", "猫猫").matched).toBe(false);
    expect(stripChiefMentionPrefix("猫猫，总结一下", "猫猫")).toBe("总结一下");
    expect(stripChiefMentionPrefix("普通文本", "猫猫")).toBe("普通文本");
  });
});
