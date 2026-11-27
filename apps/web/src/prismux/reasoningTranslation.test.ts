import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@prismux/core-contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("gt-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gt-react")>();
  return {
    ...actual,
    useGT: () => (text: string) => text,
    useMessages: () => (text: string) => text,
    msg: (text: string) => text,
  };
});

import {
  LOCAL_NMT_MODEL_ID,
  REASONING_TRANSLATION_MAX_TEXT_CHARS,
  ReasoningTranslationBody,
  ReasoningTranslationController,
  ReasoningTranslationMemoryCache,
  ReasoningTranslationRequestError,
  cancelLocalNmtDownload,
  deleteLocalNmtModel,
  getLocalNmtStatus,
  isAlreadyChineseReasoning,
  makeReasoningTranslationCacheKey,
  reasoningFragments,
  requestReasoningTranslation,
  resolveReasoningTranslationErrorHint,
  resolveReasoningTranslationModelKey,
  shouldSkipReasoningTranslation,
  startLocalNmtDownload,
  testReasoningTranslation,
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
    const loneSurrogateRe =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
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
        "Let's inspect the settings schema and verify how text model translation handles HTTP 401 errors.",
      ),
    ).toBe(false);
    expect(
      shouldSkipReasoningTranslation("Inspect the settings schema and run tests.", "zh-Hans"),
    ).toBe(false);

    // Pure Chinese -> skip
    expect(isAlreadyChineseReasoning("先检查设置模式，确认默认翻译引擎是否已启用。")).toBe(true);
    expect(
      shouldSkipReasoningTranslation("先检查设置模式，确认默认翻译引擎是否已启用。", "zh-Hans"),
    ).toBe(true);

    // Chinese with fenced code blocks, inline code, URLs, Windows/POSIX paths, and identifiers -> skip
    const chineseWithCode = [
      "先读取 `packages/contracts/src/settings.ts` 和 D:\\Fish-code\\AGY\\Prismux\\apps\\server\\src\\http.ts，",
      "核对 reasoningTranslationProvider 与 ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED 逻辑，",
      "参考 https://localhost:3773/api/reasoning/translate ：",
      "```ts",
      "export const DEFAULT_REASONING_TRANSLATION_PROVIDER = 'off';",
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
      shouldSkipReasoningTranslation(
        "Update the 思考过程汉化 label in SettingsPanels.tsx.",
        "zh-Hans",
      ),
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
      provider: "text_model",
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
        provider: "text_model",
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
      provider: "text_model",
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
      provider: "text_model",
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
      provider: "text_model",
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
      provider: "text_model",
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
          provider: "text_model",
          cached: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const res = await requestReasoningTranslation(
      { provider: "text_model", text: "Analyzing error logs" },
      {
        baseUrl: "http://127.0.0.1:3773",
        fetchImpl,
        readBearerToken: async () => "desktop-token",
      },
    );
    expect(res).toEqual({
      translatedText: "正在分析错误日志",
      provider: "text_model",
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
        provider: "text_model",
        modelKey: "dsh:deepseek-v4-flash",
        targetLanguage: "zh-Hans",
        fragmentText: "Inspecting layout",
      }),
      "正在检查布局结构",
    );
    const enabledHtml = renderToStaticMarkup(
      createElement(ReasoningTranslationBody, {
        text: "Inspecting layout",
        provider: "text_model",
        modelKey: "dsh:deepseek-v4-flash",
        cache,
      }),
    );
    expect(enabledHtml).toContain('data-slot="reasoning-translation-toolbar"');
    expect(enabledHtml).toContain("data-pmx-glass=");
    expect(enabledHtml).toContain("backdrop-blur-md");
    expect(enabledHtml).toContain('data-slot="reasoning-translation-toggle"');
    expect(enabledHtml).toContain('data-slot="reasoning-translation-copy"');
    expect(enabledHtml).toContain("motion-reduce:transition-none");
    expect(enabledHtml).toContain("正在检查布局结构");
  });

  it("renders localized short badges for local_nmt, text_model, official_api and subtle quick toggle when enabled or off", () => {
    const localCache = new ReasoningTranslationMemoryCache();
    localCache.set(
      makeReasoningTranslationCacheKey({
        provider: "local_nmt",
        modelKey: `local_nmt:${LOCAL_NMT_MODEL_ID}`,
        targetLanguage: "zh-Hans",
        fragmentText: "Inspecting local cache",
      }),
      "正在检查本地缓存",
    );
    const localHtml = renderToStaticMarkup(
      createElement(ReasoningTranslationBody, {
        text: "Inspecting local cache",
        provider: "local_nmt",
        modelKey: `local_nmt:${LOCAL_NMT_MODEL_ID}`,
        cache: localCache,
        showQuickToggle: true,
      }),
    );
    expect(localHtml).toContain('data-translation-provider="local_nmt"');
    expect(localHtml).toContain('data-slot="reasoning-translation-provider-badge"');
    expect(localHtml).toContain(">Local<");
    expect(localHtml).toContain('data-slot="reasoning-translation-quick-toggle"');
    expect(localHtml).toContain('data-quick-toggle-mode="pause"');

    const officialCache = new ReasoningTranslationMemoryCache();
    officialCache.set(
      makeReasoningTranslationCacheKey({
        provider: "official_api",
        modelKey: "official_api:deepl",
        targetLanguage: "zh-Hans",
        fragmentText: "Inspecting remote API",
      }),
      "正在检查远端接口",
    );
    const officialHtml = renderToStaticMarkup(
      createElement(ReasoningTranslationBody, {
        text: "Inspecting remote API",
        provider: "official_api",
        modelKey: "official_api:deepl",
        cache: officialCache,
      }),
    );
    expect(officialHtml).toContain('data-translation-provider="official_api"');
    expect(officialHtml).toContain(">API<");

    // Off mode with showQuickToggle renders subtle quick trigger for English text and zero toolbar/fetches.
    const offQuickHtml = renderToStaticMarkup(
      createElement(ReasoningTranslationBody, {
        text: "Checking the file path before editing.",
        provider: "off",
        showQuickToggle: true,
        onOpenSettings: () => {},
      }),
    );
    expect(offQuickHtml).toContain('data-slot="reasoning-translation-quick-toggle"');
    expect(offQuickHtml).not.toContain('data-slot="reasoning-translation-toolbar"');

    // Already-Chinese reasoning does not render quick toggle clutter even when showQuickToggle is on.
    const offChineseHtml = renderToStaticMarkup(
      createElement(ReasoningTranslationBody, {
        text: "先检查当前文件路径，然后确认是否需要修改。",
        provider: "off",
        showQuickToggle: true,
        onOpenSettings: () => {},
      }),
    );
    expect(offChineseHtml).not.toContain('data-slot="reasoning-translation-quick-toggle"');
  });
});

describe("A/B/C model keys, error hints, and local NMT / test HTTP helpers", () => {
  it("resolves accurate cache model keys across off, local_nmt, text_model, and official_api", () => {
    expect(resolveReasoningTranslationModelKey("off", DEFAULT_SERVER_SETTINGS)).toBe("");
    expect(resolveReasoningTranslationModelKey("local_nmt", DEFAULT_SERVER_SETTINGS)).toBe(
      `local_nmt:${LOCAL_NMT_MODEL_ID}`,
    );

    // text_model falls back to textGenerationModelSelection when reasoningTranslationModelSelection is null
    expect(resolveReasoningTranslationModelKey("text_model", DEFAULT_SERVER_SETTINGS)).toBe(
      `${DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.instanceId}:${DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model}`,
    );

    // text_model prefers dedicated reasoningTranslationModelSelection when set
    expect(
      resolveReasoningTranslationModelKey("text_model", {
        ...DEFAULT_SERVER_SETTINGS,
        reasoningTranslationModelSelection: {
          instanceId: ProviderInstanceId.make("dsh"),
          model: "deepseek-v4-flash",
        },
      }),
    ).toBe("dsh:deepseek-v4-flash");

    // official_api includes vendor + model or endpoint
    expect(
      resolveReasoningTranslationModelKey("official_api", {
        ...DEFAULT_SERVER_SETTINGS,
        reasoningTranslationOfficialApi: {
          ...DEFAULT_SERVER_SETTINGS.reasoningTranslationOfficialApi,
          vendor: "openai_compatible",
          endpoint: "http://127.0.0.1:11434/v1",
          model: "qwen2.5:7b",
        },
      }),
    ).toBe("official_api:openai_compatible:qwen2.5:7b");
    expect(
      resolveReasoningTranslationModelKey("official_api", {
        ...DEFAULT_SERVER_SETTINGS,
        reasoningTranslationOfficialApi: {
          ...DEFAULT_SERVER_SETTINGS.reasoningTranslationOfficialApi,
          vendor: "deepl",
          endpoint: "",
          model: "",
        },
      }),
    ).toBe("official_api:deepl");

    // Cache key isolates official_api vendors/models cleanly
    const deeplKey = makeReasoningTranslationCacheKey({
      provider: "official_api",
      modelKey: "official_api:deepl",
      targetLanguage: "zh-Hans",
      fragmentText: "Check file",
    });
    const azureKey = makeReasoningTranslationCacheKey({
      provider: "official_api",
      modelKey: "official_api:azure",
      targetLanguage: "zh-Hans",
      fragmentText: "Check file",
    });
    expect(deeplKey).not.toBe(azureKey);
  });

  it("maps structured backend error codes to localized hints and settings targets", () => {
    expect(resolveReasoningTranslationErrorHint("LOCAL_NMT_NOT_INSTALLED")).toMatchObject({
      settingsTarget: "reasoning",
    });
    expect(resolveReasoningTranslationErrorHint("OFFICIAL_API_NOT_CONFIGURED")).toMatchObject({
      settingsTarget: "reasoning",
    });
    expect(resolveReasoningTranslationErrorHint("OFFICIAL_API_AUTH_FAILED")).toMatchObject({
      settingsTarget: "reasoning",
    });
    expect(
      resolveReasoningTranslationErrorHint("ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED"),
    ).toMatchObject({
      settingsTarget: "waiver",
    });
    expect(resolveReasoningTranslationErrorHint("UNKNOWN_CODE").settingsTarget).toBeUndefined();
  });

  it("calls local-model status/download/cancel/delete and test endpoints with bearer auth", async () => {
    const calls: Array<{ url: string; method: string | undefined; body: string | undefined }> = [];
    const sampleStatus = {
      installed: false,
      downloading: true,
      progressPercent: 35,
      downloadedBytes: 20_000_000,
      totalBytes: 56_995_684,
      modelId: LOCAL_NMT_MODEL_ID,
      modelDir: "/tmp/models/reasoning-translate/mozilla-bergamot-enzh-v2.2",
      mirror: "hf_mirror",
      version: "2.2.0",
      error: null,
      sizeBytes: 0,
    };

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      if (url.endsWith("/api/reasoning/translation/test")) {
        return new Response(
          JSON.stringify({
            ok: true,
            translatedText: "在应用修复前检查文件路径。",
            latencyMs: 42,
            provider: "local_nmt",
            modelKey: LOCAL_NMT_MODEL_ID,
            error: null,
            errorCode: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(sampleStatus), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const opts = {
      baseUrl: "http://127.0.0.1:3773",
      fetchImpl,
      readBearerToken: async () => "token-123",
    };

    const status = await getLocalNmtStatus(opts);
    expect(status.progressPercent).toBe(35);

    await startLocalNmtDownload("huggingface", opts);
    await cancelLocalNmtDownload(opts);
    await deleteLocalNmtModel(opts);
    const testResult = await testReasoningTranslation("local_nmt", opts);
    expect(testResult).toMatchObject({
      ok: true,
      translatedText: "在应用修复前检查文件路径。",
      latencyMs: 42,
      provider: "local_nmt",
    });

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET http://127.0.0.1:3773/api/reasoning/translation/local-model/status",
      "POST http://127.0.0.1:3773/api/reasoning/translation/local-model/download",
      "POST http://127.0.0.1:3773/api/reasoning/translation/local-model/cancel",
      "DELETE http://127.0.0.1:3773/api/reasoning/translation/local-model",
      "POST http://127.0.0.1:3773/api/reasoning/translation/test",
    ]);
    expect(calls[1]?.body).toBe(JSON.stringify({ mirror: "huggingface" }));
    expect(calls[4]?.body).toBe(JSON.stringify({ provider: "local_nmt" }));
  });
});
