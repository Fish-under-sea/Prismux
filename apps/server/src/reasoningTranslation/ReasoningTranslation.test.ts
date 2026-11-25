import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { describe } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  type HttpClientRequest,
} from "effect/http";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  ProviderDriverKind,
  ProviderInstanceId,
  TextGenerationError,
  type ServerSettings as ServerSettingsValue,
} from "@prismux/core-contracts";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerHttp from "../http.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { ANTIGRAVITY_WAIVER_REQUIRED_DETAIL } from "../textGeneration/AntigravityTextGeneration.ts";
import {
  BING_EDGE_AUTH_ENDPOINT,
  BING_TRANSLATE_ENDPOINT,
  GOOGLE_TRANSLATE_ENDPOINT,
  REASONING_TRANSLATION_MAX_TEXT_CHARS,
  ReasoningTranslation,
  make,
  parseBingTranslatePayload,
  parseGoogleTranslatePayload,
  isAlreadyChineseReasoning,
  shouldSkipReasoningTranslation,
  type ReasoningTranslationOptions,
} from "./ReasoningTranslation.ts";

interface RecordedHttpCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | undefined>;
  readonly body: string | null;
}

const bodyToString = (request: HttpClientRequest.HttpClientRequest): string | null => {
  const body = request.body;
  if (body._tag === "Uint8Array") {
    return new TextDecoder().decode(body.body);
  }
  return null;
};

const makeMockHttpClient = (
  handler: (
    call: RecordedHttpCall,
    request: HttpClientRequest.HttpClientRequest,
  ) => Response | Promise<Response>,
) => {
  const calls: Array<RecordedHttpCall> = [];
  const client = HttpClient.make((request) =>
    Effect.tryPromise({
      try: async () => {
        const call: RecordedHttpCall = {
          method: request.method,
          url: request.url,
          headers: { ...request.headers },
          body: bodyToString(request),
        };
        calls.push(call);
        const webResponse = await handler(call, request);
        return HttpClientResponse.fromWeb(request, webResponse);
      },
      catch: (cause) => cause as never,
    }),
  );
  return { client, calls };
};

const makeStubTextGeneration = (
  impl?: Partial<TextGeneration.TextGenerationShape>,
): TextGeneration.TextGenerationShape => ({
  generateCommitMessage: () => Effect.die("unused"),
  generatePrContent: () => Effect.die("unused"),
  generateBranchName: () => Effect.die("unused"),
  generateThreadTitle: () => Effect.die("unused"),
  generateReviewGuide: () => Effect.die("unused"),
  generateTranscriptionPostProcessing: () => Effect.die("unused"),
  ...impl,
});

const buildService = (input: {
  readonly httpClient: HttpClient.HttpClient;
  readonly textGeneration?: TextGeneration.TextGenerationShape;
  readonly settings?: Partial<ServerSettingsValue>;
  readonly options?: ReasoningTranslationOptions;
}) =>
  make(input.options).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, input.httpClient),
        ServerSettings.layerTest(input.settings),
        Layer.succeed(
          TextGeneration.TextGeneration,
          TextGeneration.TextGeneration.of(input.textGeneration ?? makeStubTextGeneration()),
        ),
        NodeServices.layer,
      ),
    ),
  );

describe("ReasoningTranslation payload parsers", () => {
  it("parses Bing and Google responses cleanly", () => {
    expect(
      parseBingTranslatePayload(JSON.stringify([{ translations: [{ text: "检查配置文件" }] }])),
    ).toBe("检查配置文件");
    expect(parseBingTranslatePayload("{}")).toBeNull();
    expect(
      parseGoogleTranslatePayload(
        JSON.stringify([
          [
            ["第一句。", "First sentence.", null, null, 1],
            ["第二句。", "Second sentence.", null, null, 1],
          ],
          null,
          "en",
        ]),
      ),
    ).toBe("第一句。第二句。");
    expect(parseGoogleTranslatePayload("[]")).toBeNull();
  });
});

describe("ReasoningTranslation service", () => {
  it.effect("translates via Bing directly and passes &from= only when sourceLanguage is explicit", () =>
    Effect.gen(function* () {
      const { client, calls } = makeMockHttpClient(() =>
        new Response(JSON.stringify([{ translations: [{ text: "正在检查依赖关系" }] }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const service = yield* buildService({ httpClient: client });

      const autoResult = yield* service.translate({
        provider: "bing",
        text: "Inspecting dependencies",
      });
      expect(autoResult).toEqual({
        translatedText: "正在检查依赖关系",
        provider: "bing",
        cached: false,
      });
      expect(calls[0]?.url).toBe(`${BING_TRANSLATE_ENDPOINT}?to=zh-Hans&isEnterpriseClient=false`);
      expect(calls[0]?.body).toBe(JSON.stringify(["Inspecting dependencies"]));

      const explicitResult = yield* service.translate({
        provider: "bing",
        text: "Inspecting dependencies",
        sourceLanguage: "en",
        targetLanguage: "zh-CN",
      });
      expect(explicitResult.translatedText).toBe("正在检查依赖关系");
      expect(calls[1]?.url).toBe(
        `${BING_TRANSLATE_ENDPOINT}?to=zh-Hans&isEnterpriseClient=false&from=en`,
      );
    }),
  );

  it.effect("fetches Edge anonymous JWT token and retries once when Bing returns 401/403", () =>
    Effect.gen(function* () {
      let translateAttempts = 0;
      const { client, calls } = makeMockHttpClient((call) => {
        if (call.url === BING_EDGE_AUTH_ENDPOINT) {
          return new Response("edge-jwt-token-123", {
            status: 200,
            headers: { "content-type": "text/plain" },
          });
        }
        translateAttempts += 1;
        if (translateAttempts === 1) {
          return new Response("Unauthorized", { status: 401 });
        }
        expect(call.headers.authorization).toBe("Bearer edge-jwt-token-123");
        return new Response(JSON.stringify([{ translations: [{ text: "通过 Edge 令牌重试成功" }] }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const service = yield* buildService({ httpClient: client });
      const result = yield* service.translate({
        provider: "bing",
        text: "Retry with Edge token",
      });

      expect(result.translatedText).toBe("通过 Edge 令牌重试成功");
      expect(calls.map((c) => `${c.method} ${c.url.split("?")[0]}`)).toEqual([
        `POST ${BING_TRANSLATE_ENDPOINT}`,
        `GET ${BING_EDGE_AUTH_ENDPOINT}`,
        `POST ${BING_TRANSLATE_ENDPOINT}`,
      ]);
    }),
  );

  it.effect("translates via Google form-urlencoded endpoint and joins multi-segment output", () =>
    Effect.gen(function* () {
      const { client, calls } = makeMockHttpClient(() =>
        new Response(
          JSON.stringify([
            [
              ["先阅读 ", "First read ", null, null, 1],
              ["`settings.ts`。", "`settings.ts`.", null, null, 1],
            ],
            null,
            "en",
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      const service = yield* buildService({ httpClient: client });
      const result = yield* service.translate({
        provider: "google",
        text: "First read `settings.ts`.",
      });

      expect(result).toEqual({
        translatedText: "先阅读 `settings.ts`。",
        provider: "google",
        cached: false,
      });
      expect(calls[0]?.url).toBe(GOOGLE_TRANSLATE_ENDPOINT);
      expect(calls[0]?.headers["content-type"]).toContain("application/x-www-form-urlencoded");
      const params = new URLSearchParams(calls[0]?.body ?? "");
      expect(params.get("client")).toBe("gtx");
      expect(params.get("sl")).toBe("auto");
      expect(params.get("tl")).toBe("zh-CN");
      expect(params.get("dt")).toBe("t");
      expect(params.get("q")).toBe("First read `settings.ts`.");
    }),
  );

  it.effect("routes text_model through configured textGenerationModelSelection and propagates AGY compliance 403", () =>
    Effect.gen(function* () {
      const { client } = makeMockHttpClient(() => new Response("unexpected", { status: 500 }));
      const captured: Array<TextGeneration.ReasoningTranslationGenerationInput> = [];

      const okService = yield* buildService({
        httpClient: client,
        settings: {
          providerInstances: {
            [ProviderInstanceId.make("claudeAgent")]: {
              driver: ProviderDriverKind.make("claudeAgent"),
              enabled: true,
              config: { enabled: true },
            },
          },
          textGenerationModelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-haiku-4-5",
          },
        },
        textGeneration: makeStubTextGeneration({
          translateReasoning: (input) =>
            Effect.sync(() => {
              captured.push(input);
              return { translatedText: "检查 `apps/server/src/http.ts` 中的路由。" };
            }),
        }),
      });

      const okResult = yield* okService.translate({
        provider: "text_model",
        text: "Check routes in `apps/server/src/http.ts`.",
      });
      expect(okResult).toEqual({
        translatedText: "检查 `apps/server/src/http.ts` 中的路由。",
        provider: "text_model",
        cached: false,
        modelKey: "claudeAgent:claude-haiku-4-5",
      });
      expect(captured[0]?.modelSelection).toMatchObject({
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-haiku-4-5",
      });

      const blockedService = yield* buildService({
        httpClient: client,
        settings: {
          textGenerationModelSelection: {
            instanceId: ProviderInstanceId.make("antigravity"),
            model: "gemini-2.5-pro",
          },
        },
        textGeneration: makeStubTextGeneration({
          translateReasoning: () =>
            Effect.fail(
              new TextGenerationError({
                operation: "generateTranscriptionPostProcessing",
                detail: ANTIGRAVITY_WAIVER_REQUIRED_DETAIL,
              }),
            ),
        }),
      });

      const blocked = yield* blockedService
        .translate({
          provider: "text_model",
          text: "Attempting unsigned Antigravity translation",
        })
        .pipe(Effect.flip);
      expect(blocked.status).toBe(403);
      expect(blocked.code).toBe("ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED");
      expect(blocked.detail).toContain("ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED");
    }),
  );

  it.live("caches translations with LRU eviction and enforces max response bytes and timeout", () =>
    Effect.gen(function* () {
      let counter = 0;
      const { client } = makeMockHttpClient((call) => {
        if (call.body?.includes("OVERSIZE")) {
          return new Response("x".repeat(2048), { status: 200 });
        }
        if (call.body?.includes("SLOW")) {
          return new Promise<Response>(() => {});
        }
        counter += 1;
        return new Response(JSON.stringify([{ translations: [{ text: `译文-${counter}` }] }]), {
          status: 200,
        });
      });

      const service = yield* buildService({
        httpClient: client,
        options: {
          maxCacheEntries: 2,
          maxResponseBytes: 512,
          bingGoogleTimeoutMs: 60,
        },
      });

      const first = yield* service.translate({ provider: "bing", text: "alpha" });
      expect(first.cached).toBe(false);
      const firstAgain = yield* service.translate({ provider: "bing", text: "alpha" });
      expect(firstAgain).toEqual({ ...first, cached: true });

      // Insert beta and gamma -> evicts oldest (alpha was refreshed, wait: alpha -> beta -> gamma evicts alpha).
      yield* service.translate({ provider: "bing", text: "beta" });
      yield* service.translate({ provider: "bing", text: "gamma" });
      const alphaAfterEviction = yield* service.translate({ provider: "bing", text: "alpha" });
      expect(alphaAfterEviction.cached).toBe(false);

      const oversized = yield* service
        .translate({ provider: "bing", text: "OVERSIZE" })
        .pipe(Effect.flip);
      expect(oversized.status).toBe(502);
      expect(oversized.code).toBe("TRANSLATION_RESPONSE_TOO_LARGE");

      const timedOut = yield* service
        .translate({ provider: "bing", text: "SLOW" })
        .pipe(Effect.flip);
      expect(timedOut.status).toBe(504);
      expect(timedOut.code).toBe("TRANSLATION_TIMEOUT");
    }),
  );

  it.effect("skips upstream requests for whitespace-only or already-Chinese reasoning", () =>
    Effect.gen(function* () {
      const { client, calls } = makeMockHttpClient(() => new Response("unexpected", { status: 500 }));
      const service = yield* buildService({ httpClient: client });

      expect(isAlreadyChineseReasoning("Let's inspect settings.ts and verify Bing auth.")).toBe(
        false,
      );
      expect(
        isAlreadyChineseReasoning(
          "Now wire the 思考过程汉化 row after effort display in SettingsPanels.tsx and update unit tests.",
        ),
      ).toBe(false);
      expect(isAlreadyChineseReasoning("先检查默认配置，再确认翻译服务是否正常工作。")).toBe(true);
      expect(
        isAlreadyChineseReasoning(
          "先读取 `packages/contracts/src/settings.ts`，核对 `reasoningTranslationProvider` 默认值，并检查 D:\\Fish-code\\Prismux\\apps\\server\\src\\http.ts 中的路由与 HTTP 401 重试。",
        ),
      ).toBe(true);
      expect(shouldSkipReasoningTranslation("先检查默认配置。", "en")).toBe(false);

      const whitespace = yield* service.translate({ provider: "google", text: "   \n\t  " });
      expect(whitespace).toEqual({
        translatedText: "   \n\t  ",
        provider: "google",
        cached: false,
      });

      const chineseWithPaths =
        "先检查 `apps/server/src/http.ts` 和 reasoningTranslationProvider 默认配置，确保测试通过。";
      const skipped = yield* service.translate({ provider: "bing", text: chineseWithPaths });
      expect(skipped).toEqual({
        translatedText: chineseWithPaths,
        provider: "bing",
        cached: false,
      });
      expect(calls).toHaveLength(0);
    }),
  );
});

describe("POST /api/reasoning/translate route", () => {
  it("authenticates requests, validates payload bounds, and returns translated JSON", async () => {
    const layerAuth = Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      authenticateHttpRequest: (request) =>
        request.headers.authorization === "Bearer valid-token"
          ? Effect.succeed({
              scopes: [AuthOrchestrationReadScope, AuthOrchestrationOperateScope],
            } as never)
          : Effect.succeed({
              scopes: [AuthOrchestrationReadScope],
            } as never),
    });
    const layerTranslation = Layer.succeed(
      ReasoningTranslation,
      ReasoningTranslation.of({
        translate: (input) =>
          Effect.succeed({
            translatedText: `ZH:${input.text}`,
            provider: input.provider,
            cached: false,
          }),
      }),
    );
    const layerApp = ServerHttp.layerReasoningTranslationRoute.pipe(
      Layer.provide(Layer.mergeAll(layerAuth, layerTranslation)),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(layerApp, { disableLogger: true });

    try {
      const ok = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATE_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer valid-token",
          },
          body: JSON.stringify({ provider: "bing", text: "Plan next edit" }),
        }),
      );
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({
        translatedText: "ZH:Plan next edit",
        provider: "bing",
        cached: false,
      });

      const tooLong = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATE_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer valid-token",
          },
          body: JSON.stringify({
            provider: "google",
            text: "a".repeat(REASONING_TRANSLATION_MAX_TEXT_CHARS + 1),
          }),
        }),
      );
      expect(tooLong.status).toBe(400);

      // Read-only scope cannot invoke text_model generation.
      const forbiddenModel = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATE_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer read-only",
          },
          body: JSON.stringify({ provider: "text_model", text: "Check code" }),
        }),
      );
      expect(forbiddenModel.status).toBe(403);
    } finally {
      await dispose();
    }
  });
});
