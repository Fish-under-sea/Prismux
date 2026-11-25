import { GTProvider, initializeGT } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { CHATGPT_USAGE_LIMIT_CODE } from "@prismux/core-shared/usageLimits";

import {
  dismissThreadErrorBannerForSession,
  getThreadErrorBannerKey,
  getThreadErrorBannerMessage,
  isThreadErrorBannerDismissedForSession,
  shouldShowThreadErrorBanner,
  ThreadErrorBanner,
} from "./ThreadErrorBanner";

beforeAll(async () => {
  await initializeGT({
    defaultLocale: "en",
    locales: ["en", "zh"],
    loadTranslations: async () => ({}),
  });
});

describe("getThreadErrorBannerMessage", () => {
  it("extracts a readable nested message without trimming its whitespace", () => {
    const message =
      "  This model is not supported with a ChatGPT account.\nChoose another model.  ";
    const error = ` \n${JSON.stringify({ error: { message, code: "unsupported_model" } })}\t `;

    expect(getThreadErrorBannerMessage(error)).toBe(message);
  });

  it("keeps the diagnostics when the nested message is blank", () => {
    const error = JSON.stringify({ error: { message: " \n\t ", code: "unsupported_model" } });

    expect(getThreadErrorBannerMessage(error)).toBe(error);
  });
});

describe("ThreadErrorBanner", () => {
  it("reappears for different diagnostics with the same headline on the same thread", () => {
    const firstError = JSON.stringify({ error: { message: "Turn failed", code: "first" } });
    const secondError = JSON.stringify({ error: { message: "Turn failed", code: "second" } });
    const dismissedKey = getThreadErrorBannerKey("env:thread-b", firstError);
    dismissThreadErrorBannerForSession(dismissedKey);
    const newErrorKey = getThreadErrorBannerKey("env:thread-b", secondError);

    expect(isThreadErrorBannerDismissedForSession(dismissedKey)).toBe(true);
    expect(isThreadErrorBannerDismissedForSession(newErrorKey)).toBe(false);
    expect(
      shouldShowThreadErrorBanner(
        "env:thread-b",
        secondError,
        isThreadErrorBannerDismissedForSession(newErrorKey),
      ),
    ).toBe(true);
  });

  it("reappears when a later run fails with the same error on the same thread", () => {
    const error = "Turn failed";
    const dismissedKey = getThreadErrorBannerKey("env:thread-c", error, "run-a");
    dismissThreadErrorBannerForSession(dismissedKey);
    const laterRunKey = getThreadErrorBannerKey("env:thread-c", error, "run-b");

    expect(isThreadErrorBannerDismissedForSession(dismissedKey)).toBe(true);
    expect(isThreadErrorBannerDismissedForSession(laterRunKey)).toBe(false);
    expect(
      shouldShowThreadErrorBanner(
        "env:thread-c",
        error,
        isThreadErrorBannerDismissedForSession(laterRunKey),
      ),
    ).toBe(true);
  });

  it("renders LocalizedErrorCard with Chinese diagnosis and collapsed raw error for model failures", () => {
    const rawError = JSON.stringify({
      error: {
        code: "rate_limit_exceeded",
        message: "Too many requests from org-secret-raw-id",
      },
    });
    const html = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "zh", translations: {} },
        createElement(ThreadErrorBanner, {
          error: rawError,
          providerName: "DeepSeek Harness",
        }),
      ),
    );

    expect(html).toContain('data-localized-error-card="1"');
    expect(html).toContain("请求频率受限或模型服务繁忙（429）");
    expect(html).toContain("查看原始报错");
    expect(html).toContain("复制原始报错");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('data-localized-error-raw="1"');
    expect(html).not.toContain("org-secret-raw-id");
  });

  it("preserves ChatGPT usage limit banner layout when errorCode matches CHATGPT_USAGE_LIMIT_CODE", () => {
    const html = renderToStaticMarkup(
      createElement(
        GTProvider,
        { locale: "en", translations: {} },
        createElement(ThreadErrorBanner, {
          error: "ChatGPT usage limit reached",
          errorClass: "usage_limit",
          errorCode: CHATGPT_USAGE_LIMIT_CODE,
        }),
      ),
    );

    expect(html).toContain("ChatGPT usage limit reached");
    expect(html).toContain('data-variant="warning"');
  });
});
