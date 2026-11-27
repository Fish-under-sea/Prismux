import { describe, expect, it } from "vite-plus/test";

import {
  areSubagentModelsEquivalent,
  formatReadableSubagentModel,
  subagentThreadTitle,
  withExecutedModelNote,
} from "./subagentProjection.ts";

describe("subagentThreadTitle", () => {
  it("clips a long prompt without splitting a surrogate pair", () => {
    const title = (prompt: string) =>
      subagentThreadTitle({ parentTitle: "Parent", prompt, ordinal: 1 });

    expect(title(`${"a".repeat(68)}😀 and more work.`)).toBe(`${"a".repeat(68)}...`);
    expect(title(`${"a".repeat(67)}😀 and more work.`)).toBe(`${"a".repeat(67)}😀...`);
  });
});

describe("withExecutedModelNote", () => {
  it("suppresses false-positive model mismatch when requestedModel is a DSH/ACP JSON tuple matching executedModel", () => {
    expect(
      withExecutedModelNote("计算结果：395", '["magpie","group/deepseek"]', "group/deepseek"),
    ).toBe("计算结果：395");
    expect(
      withExecutedModelNote("ok", '["magpie", "group/deepseek"]', "magpie/group/deepseek"),
    ).toBe("ok");
    expect(
      withExecutedModelNote("ok", '["magpie","group/deepseek"]', "magpie:group/deepseek"),
    ).toBe("ok");
    expect(
      withExecutedModelNote("ok", '["magpie","group/deepseek"]', '["magpie","group/deepseek"]'),
    ).toBe("ok");
  });

  it("suppresses false-positive mismatch across optional provider prefixes", () => {
    expect(withExecutedModelNote("ok", "openai/gpt-5.4", "gpt-5.4")).toBe("ok");
    expect(withExecutedModelNote("ok", "gpt-5.4", "openai/gpt-5.4")).toBe("ok");
    expect(withExecutedModelNote("ok", "magpie/group/deepseek", "group/deepseek")).toBe("ok");
    expect(withExecutedModelNote("ok", "magpie:group/deepseek", "group/deepseek")).toBe("ok");
    expect(withExecutedModelNote("ok", "gpt-5.4", null)).toBe("ok");
    expect(withExecutedModelNote("ok", "gpt-5.4", undefined)).toBe("ok");
    expect(withExecutedModelNote("ok", "gpt-5.4", "   ")).toBe("ok");
  });

  it("reports genuine model mismatches with readable model names (never raw JSON tuple strings)", () => {
    expect(withExecutedModelNote("All steps passed.", "gpt-5.4", "gpt-5.4-mini")).toBe(
      "Requested model gpt-5.4; the provider reported running gpt-5.4-mini.\n\nAll steps passed.",
    );

    expect(withExecutedModelNote("结果正文", '["magpie","group/deepseek"]', "group/qwen")).toBe(
      "Requested model group/deepseek; the provider reported running group/qwen.\n\n结果正文",
    );

    expect(
      withExecutedModelNote(
        "结果正文",
        '["magpie","group/deepseek"]',
        '["other","group/deepseek"]',
      ),
    ).toBe(
      "Requested model magpie/group/deepseek; the provider reported running other/group/deepseek.\n\n结果正文",
    );

    expect(withExecutedModelNote("ok", "provider-a/gpt-5.4", "provider-b/gpt-5.4")).toBe(
      "Requested model provider-a/gpt-5.4; the provider reported running provider-b/gpt-5.4.\n\nok",
    );

    expect(withExecutedModelNote("ok", "qwen2.5:7b", "qwen2.5:14b")).toBe(
      "Requested model qwen2.5:7b; the provider reported running qwen2.5:14b.\n\nok",
    );
  });

  it("exposes clean model equivalence and formatting helpers", () => {
    expect(areSubagentModelsEquivalent('["magpie","group/deepseek"]', "group/deepseek")).toBe(true);
    expect(areSubagentModelsEquivalent("gpt-5.4", "gpt-5.4-mini")).toBe(false);
    expect(formatReadableSubagentModel('["magpie","group/deepseek"]')).toBe("group/deepseek");
    expect(
      formatReadableSubagentModel('["magpie","group/deepseek"]', { includeTupleProvider: true }),
    ).toBe("magpie/group/deepseek");
    expect(formatReadableSubagentModel("gpt-5.4")).toBe("gpt-5.4");
  });
});
