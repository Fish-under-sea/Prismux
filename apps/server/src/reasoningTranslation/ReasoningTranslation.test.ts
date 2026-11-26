import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { describe } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";
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
  REASONING_TRANSLATION_MAX_TEXT_CHARS,
  ReasoningTranslation,
  make,
  isAlreadyChineseReasoning,
  shouldSkipReasoningTranslation,
  type ReasoningTranslationOptions,
} from "./ReasoningTranslation.ts";

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
  readonly textGeneration?: TextGeneration.TextGenerationShape;
  readonly settings?: Partial<ServerSettingsValue>;
  readonly options?: ReasoningTranslationOptions;
}) =>
  make(input.options).pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerSettings.layerTest(input.settings),
        Layer.succeed(
          TextGeneration.TextGeneration,
          TextGeneration.TextGeneration.of(input.textGeneration ?? makeStubTextGeneration()),
        ),
        NodeServices.layer,
      ),
    ),
  );

describe("ReasoningTranslation service (text_model only)", () => {
  it.effect(
    "routes text_model through configured textGenerationModelSelection and propagates AGY compliance 403",
    () =>
      Effect.gen(function* () {
        const captured: Array<TextGeneration.ReasoningTranslationGenerationInput> = [];

        const okService = yield* buildService({
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

  it.live("caches text_model translations with LRU eviction and enforces timeout", () =>
    Effect.gen(function* () {
      let counter = 0;
      const service = yield* buildService({
        settings: {
          textGenerationModelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-haiku-4-5",
          },
        },
        textGeneration: makeStubTextGeneration({
          translateReasoning: (input) => {
            if (input.text.includes("SLOW")) {
              return Effect.never;
            }
            counter += 1;
            return Effect.succeed({ translatedText: `译文-${counter}` });
          },
        }),
        options: {
          maxCacheEntries: 2,
          textModelTimeoutMs: 60,
        },
      });

      const first = yield* service.translate({ provider: "text_model", text: "alpha" });
      expect(first.cached).toBe(false);
      const firstAgain = yield* service.translate({ provider: "text_model", text: "alpha" });
      expect(firstAgain).toEqual({ ...first, cached: true });

      yield* service.translate({ provider: "text_model", text: "beta" });
      yield* service.translate({ provider: "text_model", text: "gamma" });
      const alphaAfterEviction = yield* service.translate({ provider: "text_model", text: "alpha" });
      expect(alphaAfterEviction.cached).toBe(false);

      const timedOut = yield* service
        .translate({ provider: "text_model", text: "SLOW" })
        .pipe(Effect.flip);
      expect(timedOut.status).toBe(504);
      expect(timedOut.code).toBe("TRANSLATION_TIMEOUT");
    }),
  );

  it.effect("skips upstream requests for whitespace-only or already-Chinese reasoning", () =>
    Effect.gen(function* () {
      let called = 0;
      const service = yield* buildService({
        settings: {
          textGenerationModelSelection: {
            instanceId: ProviderInstanceId.make("claudeAgent"),
            model: "claude-haiku-4-5",
          },
        },
        textGeneration: makeStubTextGeneration({
          translateReasoning: () => {
            called += 1;
            return Effect.succeed({ translatedText: "unexpected" });
          },
        }),
      });

      expect(isAlreadyChineseReasoning("Let's inspect settings.ts and verify text model auth.")).toBe(
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

      const whitespace = yield* service.translate({ provider: "text_model", text: "   \n\t  " });
      expect(whitespace).toEqual({
        translatedText: "   \n\t  ",
        provider: "text_model",
        cached: false,
      });

      const chineseWithPaths =
        "先检查 `apps/server/src/http.ts` 和 reasoningTranslationProvider 默认配置，确保测试通过。";
      const skipped = yield* service.translate({ provider: "text_model", text: chineseWithPaths });
      expect(skipped).toEqual({
        translatedText: chineseWithPaths,
        provider: "text_model",
        cached: false,
      });
      expect(called).toBe(0);
    }),
  );
});

describe("POST /api/reasoning/translate route", () => {
  it("authenticates requests, rejects removed bing/google providers, and enforces scopes", async () => {
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
          body: JSON.stringify({ provider: "text_model", text: "Plan next edit" }),
        }),
      );
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({
        translatedText: "ZH:Plan next edit",
        provider: "text_model",
        cached: false,
      });

      // Removed third-party providers must be rejected at schema validation.
      for (const removedProvider of ["bing", "google"]) {
        const rejected = await handler(
          new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATE_PATH}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer valid-token",
            },
            body: JSON.stringify({ provider: removedProvider, text: "Plan next edit" }),
          }),
        );
        expect(rejected.status).toBe(400);
      }

      const tooLong = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATE_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer valid-token",
          },
          body: JSON.stringify({
            provider: "text_model",
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
