import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("gt-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gt-react")>();
  return {
    ...actual,
    useGT: () => (text: string) => text,
  };
});

import {
  REASONING_TRANSLATION_MAX_TEXT_CHARS,
  ReasoningTranslationBody,
  ReasoningTranslationController,
  ReasoningTranslationMemoryCache,
  ReasoningTranslationRequestError,
  isAlreadyChineseReasoning,
  makeReasoningTranslationCacheKey,
  reasoningFragments,
  requestReasoningTranslation,
  shouldSkipReasoningTranslation,
  type ReasoningTranslateFn,
} from "./reasoningTranslation";

const flushMicrotasks = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
};

describe("reasoningFragments", () => {
  it("splits paragraphs on blank lines and ignores empty/whitespace-only text", () => {
    expect(reasoningFragments("")).toEqual([]);
    expect(reasoningFragments("  \n\n\t  ")).toEqual([]);
    expect(
      reasoningFragments("First paragraph.\nLine two.\n\nSecond paragraph.\r\n  \r\nThird."),
    ).toEqual(["First paragraph.\nLine two.", "Second paragraph.", "Third."]);
  });

  it("chunks oversized paragraphs at whitespace and UTF-16 surrogate-pair safe boundaries", () => {
    const words = Array.from({ length: 120 }, (_, i) => `token${i}`).join(" ");
    const chunks = reasoningFragments(words, { maxTextChars: 120 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120);
    }

    // Surrogate-pair emoji stream must never split a high surrogate from its low surrogate.
    const emojis = "🚀".repeat(50);
    const emojiChunks = reasoningFragments(emojis, { maxTextChars: 11 });
    expect(emojiChunks.length).toBeGreaterThan(4);
    const loneSurrogateRe = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const chunk of emojiChunks) {
      expect(chunk.length).toBeLessThanOrEqual(11);
      // Every chunk is well-formed UTF-16 with no lone surrogates.
      expect(loneSurrogateRe.test(chunk)).toBe(false);
    }
    expect(emojiChunks.join("")).toBe(emojis);
  });
});

describe("Smart Chinese reasoning detection", () => {
  it("distinguishes English, Chinese, Chinese-with-paths/code, and English-with-1-Chinese-term accurately", () => {
    // Pure English -> translate
    expect(
      isAlreadyChineseReasoning(
        "Let's inspect the settings schema and verify how Bing translation handles HTTP 401 errors.",
      ),
    ).toBe(false);
    expect(
      shouldSkipReasoningTranslation("Inspect the settings schema and run tests.", "zh-Hans"),
    ).toBe(false);

    // Pure Chinese -> skip
    expect(isAlreadyChineseReasoning("先检查设置模式，确认默认翻译引擎是否已启用。")).toBe(true);
    expect(shouldSkipReasoningTranslation("先检查设置模式，确认默认翻译引擎是否已启用。", "zh-Hans")).toBe(
      true,
    );

    // Chinese with fenced code blocks, inline code, URLs, Windows/POSIX paths, and identifiers -> skip
    const chineseWithCode = [
      "先读取 `packages/contracts/src/settings.ts` 和 D:\\Fish-code\\AGY\\Prismux\\apps\\server\\src\\http.ts，",
      "核对 reasoningTranslationProvider 与 ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED 逻辑，",
      "参考 https://edge.microsoft.com/translate/translatetext ：",
      "```ts",
      "export const DEFAULT_REASONING_TRANSLATION_PROVIDER = 'bing';",
      "```",
    ].join("\n");
    expect(isAlreadyChineseReasoning(chineseWithCode)).toBe(true);
    expect(shouldSkipReasoningTranslation(chineseWithCode, "zh-Hans")).toBe(true);

    // English with 1 Chinese term -> translate
    expect(
      isAlreadyChineseReasoning(
        "Now add the 思考过程汉化 setting row right after effort display and update the unit tests.",
      ),
    ).toBe(false);
    expect(
      shouldSkipReasoningTranslation("Update the 思考过程汉化 label in SettingsPanels.tsx.", "zh-Hans"),
    ).toBe(false);

    // Non-Chinese target language -> do not skip Chinese source
    expect(shouldSkipReasoningTranslation("先检查默认配置并运行单测。", "en")).toBe(false);
  });

  it("skips network requests and renders original Chinese directly when reasoning is already Chinese", async () => {
    const translate = vi.fn<ReasoningTranslateFn>();
    const controller = new ReasoningTranslationController({
      cache: new ReasoningTranslationMemoryCache(),
      translate,
    });

    const chineseReasoning =
      "先检查 `packages/contracts/src/settings.ts` 中的默认值，然后核对 ReasoningTranslationController 的缓存键。";
    controller.update({
      text: chineseReasoning,
      running: false,
      provider: "bing",
    });
    await flushMicrotasks();

    expect(translate).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      enabled: false,
      status: "idle",
      isTranslating: false,
      displayText: chineseReasoning,
    });

    const html = renderToStaticMarkup(
      createElement(ReasoningTranslationBody, {
        text: chineseReasoning,
        provider: "bing",
      }),
    );
    expect(html).toContain("中的默认值");
    expect(html).not.toContain("reasoning-translation-toolbar");
  });
});

describe("ReasoningTranslationController", () => {
  it("makes zero translation requests when provider is off", async () => {
    const translate = vi.fn<ReasoningTranslateFn>();
    const controller = new ReasoningTranslationController({
      cache: new ReasoningTranslationMemoryCache(),
      translate,
    });

    controller.update({
      text: "First paragraph.\n\nSecond paragraph.",
      running: false,
      provider: "off",
    });
    await flushMicrotasks();

    expect(translate).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      enabled: false,
      provider: "off",
      status: "idle",
      displayText: "First paragraph.\n\nSecond paragraph.",
    });
  });

  it("translates completed paragraphs while streaming and defers the still-growing tail until done", async () => {
    const calls: Array<string> = [];
    const translate: ReasoningTranslateFn = async (input) => {
      calls.push(input.text);
      return {
        translatedText: `中文(${input.text})`,
        provider: input.provider,
        cached: false,
      };
    };
    const cache = new ReasoningTranslationMemoryCache();
    const controller = new ReasoningTranslationController({ cache, translate });

    // Streaming with 2 paragraphs: paragraph 0 is complete, paragraph 1 is still growing.
    controller.update({
      text: "Paragraph one.\n\nParagraph two is still stream",
      running: true,
      provider: "bing",
    });
    await flushMicrotasks();

    expect(calls).toEqual(["Paragraph one."]);
    expect(controller.getSnapshot()).toMatchObject({
      status: "partial",
      translatedFragmentCount: 1,
      totalFragmentCount: 2,
      displayText: "中文(Paragraph one.)\n\nParagraph two is still stream",
    });

    // Streaming completes -> tail paragraph is translated without re-requesting paragraph 0.
    controller.update({
      text: "Paragraph one.\n\nParagraph two is complete.",
      running: false,
      provider: "bing",
    });
    await flushMicrotasks();

    expect(calls).toEqual(["Paragraph one.", "Paragraph two is complete."]);
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      translatedFragmentCount: 2,
      totalFragmentCount: 2,
      displayText: "中文(Paragraph one.)\n\n中文(Paragraph two is complete.)",
    });

    // Toggle 查看原文 / 查看译文 never triggers re-requests.
    controller.toggleShowOriginal();
    expect(controller.getSnapshot().showOriginal).toBe(true);
    expect(controller.getSnapshot().displayText).toBe(
      "Paragraph one.\n\nParagraph two is complete.",
    );

    controller.toggleShowOriginal();
    expect(controller.getSnapshot().showOriginal).toBe(false);
    expect(controller.getSnapshot().displayText).toBe(
      "中文(Paragraph one.)\n\n中文(Paragraph two is complete.)",
    );
    expect(calls).toHaveLength(2);

    // Re-mounting / re-expanding a new controller with the same shared cache makes zero requests.
    const reExpanded = new ReasoningTranslationController({ cache, translate });
    reExpanded.update({
      text: "Paragraph one.\n\nParagraph two is complete.",
      running: false,
      provider: "bing",
    });
    await flushMicrotasks();
    expect(calls).toHaveLength(2);
    expect(reExpanded.getSnapshot().status).toBe("ready");
  });

  it("keys cache by (provider, modelKey, targetLanguage, fragmentText) and supports error fallback + retry", async () => {
    const keyA = makeReasoningTranslationCacheKey({
      provider: "text_model",
      modelKey: "dsh:deepseek-v4-flash",
      targetLanguage: "zh-Hans",
      fragmentText: "Check file",
    });
    const keyB = makeReasoningTranslationCacheKey({
      provider: "text_model",
      modelKey: "codex:gpt-5.4-mini",
      targetLanguage: "zh-Hans",
      fragmentText: "Check file",
    });
    expect(keyA).not.toBe(keyB);

    let attempts = 0;
    const translate: ReasoningTranslateFn = async (input) => {
      attempts += 1;
      if (attempts === 1) {
        throw new ReasoningTranslationRequestError("Upstream timeout", {
          status: 504,
          code: "TRANSLATION_TIMEOUT",
        });
      }
      return {
        translatedText: "重试后翻译成功",
        provider: input.provider,
        cached: false,
      };
    };

    const controller = new ReasoningTranslationController({
      cache: new ReasoningTranslationMemoryCache(),
      translate,
    });
    controller.update({
      text: "Retry test fragment",
      running: false,
      provider: "google",
    });
    await flushMicrotasks();

    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      error: "Upstream timeout",
      errorCode: "TRANSLATION_TIMEOUT",
      displayText: "Retry test fragment",
    });

    controller.retry();
    await flushMicrotasks();
    expect(controller.getSnapshot()).toMatchObject({
      status: "ready",
      error: null,
      displayText: "重试后翻译成功",
    });
  });
});

describe("requestReasoningTranslation", () => {
  it("POSTs to /api/reasoning/translate with bearer auth and maps structured errors", async () => {
    const seen: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          translatedText: "正在分析错误日志",
          provider: "bing",
          cached: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const res = await requestReasoningTranslation(
      { provider: "bing", text: "Analyzing error logs" },
      {
        baseUrl: "http://127.0.0.1:3773",
        fetchImpl,
        readBearerToken: async () => "desktop-token",
      },
    );
    expect(res).toEqual({
      translatedText: "正在分析错误日志",
      provider: "bing",
      cached: false,
    });
    expect(seen[0]?.url).toBe("http://127.0.0.1:3773/api/reasoning/translate");
    expect((seen[0]?.init?.headers as Record<string, string> | undefined)?.authorization).toBe(
      "Bearer desktop-token",
    );

    const errorFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          error: "Antigravity waiver required",
          code: "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED",
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      );

    await expect(
      requestReasoningTranslation(
        { provider: "text_model", text: "Check compliance" },
        {
          baseUrl: "http://127.0.0.1:3773",
          fetchImpl: errorFetch,
          readBearerToken: async () => null,
        },
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED",
    });
  });
});

describe("ReasoningTranslationBody SSR rendering", () => {
  it("renders raw reasoning cleanly when provider is off and glass-aware toolbar when enabled", () => {
    expect(REASONING_TRANSLATION_MAX_TEXT_CHARS).toBe(4_000);
    const offHtml = renderToStaticMarkup(
      createElement(ReasoningTranslationBody, {
        text: "Inspecting layout",
        provider: "off",
      }),
    );
    expect(offHtml).toContain("Inspecting layout");
    expect(offHtml).not.toContain("reasoning-translation-toggle");
    expect(offHtml).not.toContain("reasoning-translation-toolbar");

    const cache = new ReasoningTranslationMemoryCache();
    cache.set(
      makeReasoningTranslationCacheKey({
        provider: "bing",
        modelKey: "",
        targetLanguage: "zh-Hans",
        fragmentText: "Inspecting layout",
      }),
      "正在检查布局结构",
    );
    const enabledHtml = renderToStaticMarkup(
      createElement(ReasoningTranslationBody, {
        text: "Inspecting layout",
        provider: "bing",
        cache,
      }),
    );
    expect(enabledHtml).toContain('data-slot="reasoning-translation-toolbar"');
    expect(enabledHtml).toContain("data-pmx-glass=");
    expect(enabledHtml).toContain("backdrop-blur-md");
    expect(enabledHtml).toContain('data-slot="reasoning-translation-toggle"');
    expect(enabledHtml).toContain('data-slot="reasoning-translation-copy"');
    expect(enabledHtml).toContain("motion-reduce:transition-none");
    expect(enabledHtml).toContain("Bing");
    expect(enabledHtml).toContain("正在检查布局结构");
  });
});
