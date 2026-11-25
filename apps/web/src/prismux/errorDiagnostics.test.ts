import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { diagnoseModelError, formatRawErrorForDisplay } from "./errorDiagnostics";
import { LocalizedErrorCard } from "./LocalizedErrorCard";

describe("errorDiagnostics", () => {
  it("diagnoses 401 authentication errors including nested OpenAI & Anthropic JSON payloads", () => {
    const openaiRaw = JSON.stringify({
      error: {
        message: "Incorrect API key provided: sk-proj-****.",
        type: "invalid_request_error",
        code: "invalid_api_key",
      },
    });
    const openaiDiagnosed = diagnoseModelError(openaiRaw, { providerName: "Codex" });
    expect(openaiDiagnosed.category).toBe("auth");
    expect(openaiDiagnosed.titleZh).toBe("API 密钥或登录凭证无效（401）");
    expect(openaiDiagnosed.statusBadge).toBe("HTTP 401");
    expect(openaiDiagnosed.diagnosisZh).toContain("Codex");
    expect(openaiDiagnosed.suggestionsZh.length).toBeGreaterThanOrEqual(1);
    expect(openaiDiagnosed.rawError).toBe(openaiRaw);
    expect(openaiDiagnosed.formattedRawError).toBe(JSON.stringify(JSON.parse(openaiRaw), null, 2));

    const anthropicRaw =
      'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    const anthropicDiagnosed = diagnoseModelError(anthropicRaw);
    expect(anthropicDiagnosed.category).toBe("auth");
    expect(anthropicDiagnosed.titleZh).toBe("API 密钥或登录凭证无效（401）");
    expect(anthropicDiagnosed.formattedRawError).toContain("API Error: 401");
    expect(anthropicDiagnosed.formattedRawError).toContain('"authentication_error"');

    expect(diagnoseModelError("UNAUTHENTICATED: login required").category).toBe("auth");
  });

  it("diagnoses 402 / insufficient_quota / billing / credit / balance errors", () => {
    const openRouter402 = JSON.stringify({
      error: { code: 402, message: "Insufficient credits. Add credits to continue." },
    });
    const diagnosed402 = diagnoseModelError(openRouter402);
    expect(diagnosed402.category).toBe("quota");
    expect(diagnosed402.titleZh).toBe("账户余额或可用额度不足");
    expect(diagnosed402.statusBadge).toBe("HTTP 402");

    const openaiQuota = JSON.stringify({
      error: {
        message: "You exceeded your current quota, please check your plan and billing details.",
        type: "insufficient_quota",
        code: "insufficient_quota",
      },
    });
    expect(diagnoseModelError(openaiQuota).category).toBe("quota");

    const deepseekBalance = "HTTP 402: Insufficient Balance for current account";
    expect(diagnoseModelError(deepseekBalance).category).toBe("quota");
  });

  it("diagnoses 429 / 529 / rate_limit / usage_limit / overloaded errors", () => {
    const rateLimitJson = JSON.stringify({
      error: {
        code: 429,
        message: "Too Many Requests: rate limit reached for requests",
        status: "RESOURCE_EXHAUSTED",
      },
    });
    const rateDiagnosed = diagnoseModelError(rateLimitJson);
    expect(rateDiagnosed.category).toBe("rate_limit");
    expect(rateDiagnosed.titleZh).toBe("请求频率受限或模型服务繁忙（429）");
    expect(rateDiagnosed.statusBadge).toBe("HTTP 429");

    const overloaded =
      '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';
    const overloadedDiagnosed = diagnoseModelError(`HTTP 529 ${overloaded}`);
    expect(overloadedDiagnosed.category).toBe("rate_limit");
    expect(overloadedDiagnosed.statusBadge).toBe("HTTP 529");

    const usageLimitByClass = diagnoseModelError("Limit reached", {
      errorClass: "usage_limit",
    });
    expect(usageLimitByClass.category).toBe("rate_limit");
  });

  it("diagnoses 403 / compliance guard / permission_denied errors", () => {
    const waiverBlock = JSON.stringify({
      error: {
        code: "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED",
        message: "Subscription orchestration requires signing the risk waiver",
      },
    });
    const waiverDiagnosed = diagnoseModelError(waiverBlock);
    expect(waiverDiagnosed.category).toBe("policy_guard");
    expect(waiverDiagnosed.titleZh).toBe("访问被拒绝或触发合规风控拦截（403）");
    expect(waiverDiagnosed.statusBadge).toBe("风控拦截");
    expect(waiverDiagnosed.suggestionsZh.some((tip) => tip.includes("免责"))).toBe(true);

    const agyUnattended = diagnoseModelError("AGY_UNATTENDED_FORBIDDEN: cron disabled");
    expect(agyUnattended.category).toBe("policy_guard");
    expect(agyUnattended.diagnosisZh).toContain("无人值守");

    const forbidden403 = diagnoseModelError("HTTP 403 Forbidden: PERMISSION_DENIED");
    expect(forbidden403.category).toBe("policy_guard");
    expect(forbidden403.statusBadge).toBe("HTTP 403");
  });

  it("diagnoses 404 / model_not_found / unsupported model errors", () => {
    const raw = JSON.stringify({
      error: {
        message: "The model `gpt-99-ultra` does not exist or you do not have access to it.",
        code: "model_not_found",
      },
    });
    const diagnosed = diagnoseModelError(raw);
    expect(diagnosed.category).toBe("model_not_found");
    expect(diagnosed.titleZh).toBe("所选模型不存在或当前端点不支持（404）");

    const openRouter404 =
      '404 {"error":{"message":"No endpoints found for deepseek/unknown-v9","code":404}}';
    const orDiagnosed = diagnoseModelError(openRouter404);
    expect(orDiagnosed.category).toBe("model_not_found");
    expect(orDiagnosed.statusBadge).toBe("HTTP 404");

    expect(
      diagnoseModelError("This model is not supported with your current endpoint.").category,
    ).toBe("model_not_found");
  });

  it("diagnoses context_length_exceeded / prompt too long even when HTTP 400 is present", () => {
    const raw =
      'HTTP 400 {"error":{"type":"invalid_request_error","code":"context_length_exceeded","message":"This model\'s maximum context length is 128000 tokens. Your prompt is too long."}}';
    const diagnosed = diagnoseModelError(raw);
    expect(diagnosed.category).toBe("context_limit");
    expect(diagnosed.titleZh).toBe("上下文长度超出模型上限");
    expect(diagnosed.suggestionsZh.some((tip) => tip.includes("/compact"))).toBe(true);

    expect(diagnoseModelError("Error: too many tokens in request").category).toBe("context_limit");
  });

  it("diagnoses 500 / 502 / 503 / 504 upstream server errors", () => {
    for (const [sample, badge] of [
      ["HTTP 500 Internal Server Error", "HTTP 500"],
      ["502 Bad Gateway from upstream proxy", "HTTP 502"],
      ['{"error":{"code":503,"message":"Service Unavailable"}}', "HTTP 503"],
      ["HTTP 504 Gateway Timeout while awaiting upstream", "HTTP 504"],
    ] as const) {
      const diagnosed = diagnoseModelError(sample);
      expect(diagnosed.category).toBe("upstream_5xx");
      expect(diagnosed.titleZh).toBe("上游模型服务临时异常（5xx）");
      expect(diagnosed.statusBadge).toBe(badge);
    }
  });

  it("diagnoses network / TLS / proxy / timeout errors", () => {
    for (const sample of [
      "TypeError: fetch failed (ECONNREFUSED 127.0.0.1:7895)",
      "Error: read ECONNRESET",
      "getaddrinfo ENOTFOUND api.example.invalid",
      "Request timed out (ETIMEDOUT)",
      "TLS handshake failed: UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "Proxy connection refused on socket",
    ]) {
      const diagnosed = diagnoseModelError(sample);
      expect(diagnosed.category).toBe("network");
      expect(diagnosed.titleZh).toBe("网络连接中断或端点/代理不可达");
      expect(diagnosed.statusBadge).toBe("网络异常");
    }
  });

  it("diagnoses local CLI / ACP subprocess exit & spawn errors", () => {
    const spawnEnoent = diagnoseModelError("Error: spawn dsh ENOENT");
    expect(spawnEnoent.category).toBe("cli_process");
    expect(spawnEnoent.titleZh).toBe("本地智能体 CLI / ACP 进程异常退出");
    expect(spawnEnoent.statusBadge).toBe("CLI 进程");

    const acpCrash = diagnoseModelError(
      '{"jsonrpc":"2.0","error":{"code":-32000,"message":"ACP process exited with code 1 (SIGTERM)"}}',
    );
    expect(acpCrash.category).toBe("cli_process");
    expect(acpCrash.statusBadge).toBe("ACP");

    expect(diagnoseModelError("Child process terminated with SIGKILL").category).toBe("cli_process");
  });

  it("diagnoses 400 bad request / schema / invalid JSON errors", () => {
    const raw = JSON.stringify({
      error: {
        type: "invalid_request_error",
        message: "Invalid schema for tool parameters",
      },
    });
    const diagnosed = diagnoseModelError(raw);
    expect(diagnosed.category).toBe("bad_request");
    expect(diagnosed.titleZh).toBe("请求参数或协议格式异常（400）");
    expect(diagnosed.statusBadge).toBe("HTTP 400");
  });

  it("diagnoses aborted / cancelled / interrupted errors", () => {
    for (const sample of [
      "AbortError: Request was aborted",
      "Turn cancelled by user",
      "Generation interrupted before completion",
    ]) {
      const diagnosed = diagnoseModelError(sample);
      expect(diagnosed.category).toBe("cancelled");
      expect(diagnosed.titleZh).toBe("本次请求已中断或被取消");
    }
  });

  it("falls back cleanly for unknown errors and unwraps stringified nested JSON", () => {
    const nestedStringified = JSON.stringify({
      error: {
        message: JSON.stringify({
          error: { code: 429, message: "Too many requests from nested envelope" },
        }),
      },
    });
    expect(diagnoseModelError(nestedStringified).category).toBe("rate_limit");

    const unknown = diagnoseModelError("Completely unexpected opaque failure xyz-999");
    expect(unknown.category).toBe("unknown");
    expect(unknown.titleZh).toBe("模型调用失败");
    expect(unknown.diagnosisZh).toContain("未归类异常");
    expect(unknown.formattedRawError).toBe("Completely unexpected opaque failure xyz-999");

    // Pretty-prints valid JSON and leaves plain strings untouched.
    expect(formatRawErrorForDisplay('{"a":1,"b":{"c":2}}')).toBe(
      '{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}',
    );
    expect(formatRawErrorForDisplay("plain text error")).toBe("plain text error");
  });
});

describe("LocalizedErrorCard markup", () => {
  it("renders Chinese title, badge, diagnosis, suggestions, and collapses raw original error by default", () => {
    const rawPayload = JSON.stringify({
      error: {
        code: "invalid_api_key",
        message: "Incorrect API key provided: sk-secret-raw-sentinel-xyz",
      },
    });

    const html = renderToStaticMarkup(
      createElement(LocalizedErrorCard, {
        error: rawPayload,
        providerName: "DeepSeek Harness",
      }),
    );

    expect(html).toContain('data-localized-error-card="1"');
    expect(html).toContain('data-error-category="auth"');
    expect(html).toContain("API 密钥或登录凭证无效（401）");
    expect(html).toContain("HTTP 401");
    expect(html).toContain("DeepSeek Harness");
    expect(html).toContain("查看原始报错");
    expect(html).toContain("复制原始报错");
    expect(html).toContain('aria-expanded="false"');
    // Raw error <pre> container MUST NOT be rendered when collapsed by default!
    expect(html).not.toContain('data-localized-error-raw="1"');
    expect(html).not.toContain("sk-secret-raw-sentinel-xyz");

    // When expanded, renders full unclipped formatted raw error inside monospace <pre>.
    const expandedHtml = renderToStaticMarkup(
      createElement(LocalizedErrorCard, {
        error: rawPayload,
        providerName: "DeepSeek Harness",
        defaultExpanded: true,
      }),
    );
    expect(expandedHtml).toContain("收起原始报错");
    expect(expandedHtml).toContain('aria-expanded="true"');
    expect(expandedHtml).toContain('data-localized-error-raw="1"');
    expect(expandedHtml).toContain("sk-secret-raw-sentinel-xyz");
    expect(expandedHtml).toContain("&quot;invalid_api_key&quot;");
  });
});
