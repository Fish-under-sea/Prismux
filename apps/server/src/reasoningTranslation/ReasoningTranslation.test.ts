// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Tests compute golden HMAC/SHA-256 vectors and use temp directories.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { describe, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/http";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  ProviderInstanceId,
  TextGenerationError,
  type ReasoningTranslationOfficialApiSettings,
  type ServerSettings as ServerSettingsValue,
} from "@prismux/core-contracts";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../config.ts";
import * as ServerHttp from "../http.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { ANTIGRAVITY_WAIVER_REQUIRED_DETAIL } from "../textGeneration/AntigravityTextGeneration.ts";
import {
  DEFAULT_AZURE_TRANSLATOR_ENDPOINT,
  DEFAULT_DEEPL_FREE_URL,
  DEFAULT_DEEPL_PRO_URL,
  DEFAULT_TENCENT_TMT_ENDPOINT,
  DEFAULT_VOLCANO_TRANSLATE_ENDPOINT,
  LOCAL_NMT_MODEL_ID,
  LocalNmtEngine,
  REASONING_TRANSLATION_MAX_TEXT_CHARS,
  REASONING_TRANSLATION_TEST_SAMPLE_TEXT,
  ReasoningTranslation,
  isAlreadyChineseReasoning,
  make,
  shouldSkipReasoningTranslation,
  signTencentCloudTc3Request,
  signVolcanoRequest,
  validateOfficialApiEndpointUrl,
  type LocalNmtManifestFile,
  type LocalNmtModelStatus,
  type ReasoningTranslationOptions,
} from "./ReasoningTranslation.ts";
import {
  maskTechnicalTokens,
  restoreTechnicalTokens,
  translateWithTechnicalTokenProtection,
} from "./technicalTokens.ts";

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
  Effect.scoped(
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
    ),
  );

const sha256 = (data: string | Uint8Array): string =>
  NodeCrypto.createHash("sha256").update(data).digest("hex");

const hmacSha256 = (key: string | Buffer, data: string): Buffer =>
  NodeCrypto.createHmac("sha256", key).update(data, "utf8").digest();

const makeTempStateDir = (): string =>
  NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "prismux-reasoning-nmt-test-"));

const makeTestManifest = (
  payloads: Readonly<Record<string, Buffer>>,
): ReadonlyArray<LocalNmtManifestFile> => [
  {
    filename: "bergamot-translator.js",
    role: "loader",
    size: payloads["bergamot-translator.js"]!.byteLength,
    sha256: sha256(payloads["bergamot-translator.js"]!),
    urlsByMirror: {
      huggingface: [
        "https://raw.githubusercontent.com/example/loader.js",
        "https://cdn.jsdelivr.net/example/loader.js",
      ],
      hf_mirror: [
        "https://cdn.jsdelivr.net/example/loader.js",
        "https://raw.githubusercontent.com/example/loader.js",
      ],
    },
  },
  {
    filename: "bergamot-translator.wasm",
    role: "wasm",
    size: payloads["bergamot-translator.wasm"]!.byteLength,
    sha256: sha256(payloads["bergamot-translator.wasm"]!),
    urlsByMirror: {
      huggingface: ["https://cdn.example.test/bergamot.wasm"],
      hf_mirror: ["https://cdn.example.test/bergamot.wasm"],
    },
  },
  {
    filename: "model.enzh.intgemm.alphas.bin",
    role: "model",
    size: payloads["model.enzh.intgemm.alphas.bin"]!.byteLength,
    sha256: sha256(payloads["model.enzh.intgemm.alphas.bin"]!),
    urlsByMirror: {
      huggingface: ["https://cdn.example.test/model.bin"],
      hf_mirror: ["https://cdn.example.test/model.bin"],
    },
  },
  {
    filename: "srcvocab.enzh.spm",
    role: "srcvocab",
    size: payloads["srcvocab.enzh.spm"]!.byteLength,
    sha256: sha256(payloads["srcvocab.enzh.spm"]!),
    urlsByMirror: {
      huggingface: ["https://cdn.example.test/srcvocab.spm"],
      hf_mirror: ["https://cdn.example.test/srcvocab.spm"],
    },
  },
  {
    filename: "trgvocab.enzh.spm",
    role: "trgvocab",
    size: payloads["trgvocab.enzh.spm"]!.byteLength,
    sha256: sha256(payloads["trgvocab.enzh.spm"]!),
    urlsByMirror: {
      huggingface: ["https://cdn.example.test/trgvocab.spm"],
      hf_mirror: ["https://cdn.example.test/trgvocab.spm"],
    },
  },
  {
    filename: "lex.50.50.enzh.s2t.bin",
    role: "lex",
    size: payloads["lex.50.50.enzh.s2t.bin"]!.byteLength,
    sha256: sha256(payloads["lex.50.50.enzh.s2t.bin"]!),
    urlsByMirror: {
      huggingface: ["https://cdn.example.test/lex.bin"],
      hf_mirror: ["https://cdn.example.test/lex.bin"],
    },
  },
];

const TEST_PAYLOADS: Readonly<Record<string, Buffer>> = {
  "bergamot-translator.js": Buffer.from("// loader stub", "utf8"),
  "bergamot-translator.wasm": Buffer.from("wasm-bytes-12345", "utf8"),
  "model.enzh.intgemm.alphas.bin": Buffer.from("model-weights-9876543210", "utf8"),
  "srcvocab.enzh.spm": Buffer.from("src-vocab", "utf8"),
  "trgvocab.enzh.spm": Buffer.from("trg-vocab", "utf8"),
  "lex.50.50.enzh.s2t.bin": Buffer.from("lex-table", "utf8"),
};

const makeMockManifestFetch = (
  payloads: Readonly<Record<string, Buffer>>,
  overrides?: {
    readonly requestedUrls?: string[];
    readonly corruptFilename?: string;
    readonly holdUntilAbort?: boolean;
  },
): typeof fetch => {
  const urlToFile = new Map<string, string>([
    ["https://raw.githubusercontent.com/example/loader.js", "bergamot-translator.js"],
    ["https://cdn.jsdelivr.net/example/loader.js", "bergamot-translator.js"],
    ["https://cdn.example.test/bergamot.wasm", "bergamot-translator.wasm"],
    ["https://cdn.example.test/model.bin", "model.enzh.intgemm.alphas.bin"],
    ["https://cdn.example.test/srcvocab.spm", "srcvocab.enzh.spm"],
    ["https://cdn.example.test/trgvocab.spm", "trgvocab.enzh.spm"],
    ["https://cdn.example.test/lex.bin", "lex.50.50.enzh.s2t.bin"],
  ]);

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    overrides?.requestedUrls?.push(url);
    const filename = urlToFile.get(url);
    if (!filename) {
      return new Response("Not Found", { status: 404 });
    }
    const raw = payloads[filename]!;
    const bytes =
      overrides?.corruptFilename === filename
        ? Buffer.from(raw.map((byte, idx) => (idx === 0 ? byte ^ 0xff : byte)))
        : raw;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (overrides?.holdUntilAbort) {
          await new Promise<void>((_resolve, reject) => {
            if (init?.signal?.aborted) {
              reject(new DOMException("Aborted", "AbortError"));
              return;
            }
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
        }
        if (init?.signal?.aborted) {
          controller.error(new DOMException("Aborted", "AbortError"));
          return;
        }
        const half = Math.max(1, Math.floor(bytes.byteLength / 2));
        controller.enqueue(new Uint8Array(bytes.subarray(0, half)));
        if (half < bytes.byteLength) {
          controller.enqueue(new Uint8Array(bytes.subarray(half)));
        }
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
};

describe("technicalTokens placeholder protection", () => {
  it("preserves fenced code blocks, inline code, URLs, Windows/POSIX paths, and filenames verbatim", async () => {
    const source = [
      "### Step 1: Inspect `apps/server/src/http.ts`",
      "- Check https://api.deepl.com/v2/translate and D:\\Work\\Prismux\\settings.ts before editing.",
      "- Keep packages/contracts/src/settings.ts clean.",
      "```ts",
      "const untouched = 'Check the path in English';",
      "```",
      "Finally verify config.json after rebuild.",
    ].join("\n");

    const receivedLines: string[] = [];
    const output = await translateWithTechnicalTokenProtection(source, async (lines) => {
      receivedLines.push(...lines);
      // Simulate an NMT engine that even adds spaces around placeholders and lowercases one.
      return lines.map((line) =>
        line
          .replace("PMX000Z", "pmx 000 z")
          .replace(/^Step 1: Inspect/, "步骤 1：检查")
          .replace(/^Check/, "检查")
          .replace("before editing.", "再进行编辑。")
          .replace(/^Keep/, "保持")
          .replace("clean.", "整洁。")
          .replace(/^Finally verify/, "最后验证")
          .replace("after rebuild.", "在重新构建后。"),
      );
    });

    // Fenced code block must NEVER be sent to the translator.
    expect(receivedLines.join("\n")).not.toContain("const untouched");
    expect(output).toContain("### 步骤 1：检查 `apps/server/src/http.ts`");
    expect(output).toContain(
      "- 检查 https://api.deepl.com/v2/translate and D:\\Work\\Prismux\\settings.ts 再进行编辑。",
    );
    expect(output).toContain("- 保持 packages/contracts/src/settings.ts 整洁。");
    expect(output).toContain("```ts\nconst untouched = 'Check the path in English';\n```");
    expect(output).toContain("最后验证 config.json 在重新构建后。");

    const masked = maskTechnicalTokens("See `foo()` at ./src/a.ts");
    expect(masked.tokens).toEqual(["`foo()`", "./src/a.ts"]);
    expect(restoreTechnicalTokens(masked.maskedText, masked.tokens)).toBe(
      "See `foo()` at ./src/a.ts",
    );
  });
});

describe("Engine A: ReasoningTranslation text_model", () => {
  it.effect(
    "prefers dedicated reasoningTranslationModelSelection over textGenerationModelSelection, falls back when null, and propagates AGY compliance 403",
    () =>
      Effect.gen(function* () {
        const captured: Array<TextGeneration.ReasoningTranslationGenerationInput> = [];

        const dedicatedService = yield* buildService({
          settings: {
            textGenerationModelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.4-mini",
            },
            reasoningTranslationModelSelection: {
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

        const dedicatedResult = yield* dedicatedService.translate({
          provider: "text_model",
          text: "Check routes in `apps/server/src/http.ts`.",
        });
        expect(dedicatedResult).toEqual({
          translatedText: "检查 `apps/server/src/http.ts` 中的路由。",
          provider: "text_model",
          cached: false,
          modelKey: "claudeAgent:claude-haiku-4-5",
        });
        expect(captured[0]?.modelSelection).toMatchObject({
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-haiku-4-5",
        });

        // Null override falls back cleanly to textGenerationModelSelection.
        const fallbackCaptured: Array<TextGeneration.ReasoningTranslationGenerationInput> = [];
        const fallbackService = yield* buildService({
          settings: {
            textGenerationModelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.4-mini",
            },
            reasoningTranslationModelSelection: null,
          },
          textGeneration: makeStubTextGeneration({
            translateReasoning: (input) =>
              Effect.sync(() => {
                fallbackCaptured.push(input);
                return { translatedText: "回退到全局文本生成模型。" };
              }),
          }),
        });
        const fallbackResult = yield* fallbackService.translate({
          provider: "text_model",
          text: "Fallback to global text generation model.",
        });
        expect(fallbackResult.modelKey).toBe("codex:gpt-5.4-mini");
        expect(fallbackCaptured[0]?.modelSelection).toMatchObject({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4-mini",
        });

        // Unsigned Antigravity subscription OAuth account remains blocked with HTTP 403.
        const blockedService = yield* buildService({
          settings: {
            reasoningTranslationModelSelection: {
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
      const alphaAfterEviction = yield* service.translate({
        provider: "text_model",
        text: "alpha",
      });
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

      expect(
        isAlreadyChineseReasoning("Let's inspect settings.ts and verify text model auth."),
      ).toBe(false);
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

describe("Engine B: LocalNmtEngine (pure local offline NMT)", () => {
  it("reports uninstalled without network, fails with 412 before install, downloads with mirror + SHA-256 verification, runs offline with placeholder protection & idle unload, and deletes cleanly", async () => {
    const stateDir = makeTempStateDir();
    const manifest = makeTestManifest(TEST_PAYLOADS);
    const requestedUrls: string[] = [];
    let runtimeLoads = 0;
    let runtimeDisposals = 0;

    const engine = new LocalNmtEngine({
      stateDir,
      manifest,
      idleUnloadMs: 40,
      fetchImpl: makeMockManifestFetch(TEST_PAYLOADS, { requestedUrls }),
      runtimeFactory: async () => {
        runtimeLoads += 1;
        return {
          translateLines: async (lines) => lines.map((line) => `本地译文:${line}`),
          dispose: () => {
            runtimeDisposals += 1;
          },
        };
      },
    });

    try {
      // Zero network calls on status inspection.
      const initial = engine.getStatus();
      expect(initial.installed).toBe(false);
      expect(initial.downloading).toBe(false);
      expect(initial.progressPercent).toBe(0);
      expect(initial.sizeBytes).toBe(0);
      expect(initial.modelDir).toContain(
        NodePath.join("models", "reasoning-translate", LOCAL_NMT_MODEL_ID),
      );
      expect(requestedUrls).toHaveLength(0);

      // Translating before download fails cleanly with 412 LOCAL_NMT_NOT_INSTALLED.
      await expect(engine.translate("Check path")).rejects.toMatchObject({
        code: "LOCAL_NMT_NOT_INSTALLED",
        status: 412,
      });

      // Explicit download using hf_mirror prioritizes jsDelivr mirror first.
      const installed = await engine.downloadModel({ mirror: "hf_mirror" });
      expect(installed.installed).toBe(true);
      expect(installed.downloading).toBe(false);
      expect(installed.progressPercent).toBe(100);
      expect(installed.mirror).toBe("hf_mirror");
      expect(installed.sizeBytes).toBe(installed.totalBytes);
      expect(requestedUrls[0]).toBe("https://cdn.jsdelivr.net/example/loader.js");

      // Offline translation preserves inline code and fenced code blocks verbatim.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const translated = await engine.translate(
          "Inspect `apps/server/src/http.ts` first.\n```ts\nconst x = 1;\n```",
        );
        expect(translated).toBe(
          "本地译文:Inspect `apps/server/src/http.ts` first.\n```ts\nconst x = 1;\n```",
        );
        expect(runtimeLoads).toBe(1);
        expect(engine.isRuntimeLoaded()).toBe(true);

        // Idle-unload timer frees runtime automatically when unused.
        vi.advanceTimersByTime(50);
        expect(engine.isRuntimeLoaded()).toBe(false);
        expect(runtimeDisposals).toBe(1);
      } finally {
        vi.useRealTimers();
      }

      // Removal deletes disk files cleanly.
      const removed = await engine.removeModel();
      expect(removed.installed).toBe(false);
      expect(removed.sizeBytes).toBe(0);
      expect(NodeFS.existsSync(engine.modelDir)).toBe(false);
    } finally {
      engine.dispose();
      NodeFS.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("fails closed on SHA-256 checksum mismatch and rejects non-HTTPS URLs", async () => {
    const stateDir = makeTempStateDir();
    const manifest = makeTestManifest(TEST_PAYLOADS);

    const corruptEngine = new LocalNmtEngine({
      stateDir,
      manifest,
      fetchImpl: makeMockManifestFetch(TEST_PAYLOADS, {
        corruptFilename: "model.enzh.intgemm.alphas.bin",
      }),
    });

    const insecureManifest: LocalNmtManifestFile[] = [
      {
        ...manifest[0]!,
        urlsByMirror: {
          huggingface: ["http://insecure.example.test/loader.js"],
          hf_mirror: ["http://insecure.example.test/loader.js"],
        },
      },
    ];
    const insecureEngine = new LocalNmtEngine({
      stateDir,
      modelId: "insecure-test",
      manifest: insecureManifest,
      fetchImpl: makeMockManifestFetch(TEST_PAYLOADS),
    });

    try {
      await expect(corruptEngine.downloadModel({ mirror: "huggingface" })).rejects.toMatchObject({
        code: "LOCAL_NMT_CHECKSUM_MISMATCH",
        status: 502,
      });
      const statusAfterCorrupt = corruptEngine.getStatus();
      expect(statusAfterCorrupt.installed).toBe(false);
      expect(statusAfterCorrupt.error).toContain("SHA-256 verification failed");
      expect(NodeFS.existsSync(corruptEngine.modelDir)).toBe(false);

      await expect(insecureEngine.downloadModel({ mirror: "huggingface" })).rejects.toMatchObject({
        code: "LOCAL_NMT_INSECURE_URL",
        status: 400,
      });
    } finally {
      corruptEngine.dispose();
      insecureEngine.dispose();
      NodeFS.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("cancels an in-flight download cleanly and removes staging artifacts", async () => {
    const stateDir = makeTempStateDir();
    const manifest = makeTestManifest(TEST_PAYLOADS);
    const engine = new LocalNmtEngine({
      stateDir,
      manifest,
      fetchImpl: makeMockManifestFetch(TEST_PAYLOADS, { holdUntilAbort: true }),
    });

    try {
      const started = engine.startDownload({ mirror: "huggingface" });
      expect(started.downloading).toBe(true);

      const cancelled = await engine.cancelDownload();
      expect(cancelled.downloading).toBe(false);
      expect(cancelled.installed).toBe(false);
      expect(cancelled.error).toBeNull();
      expect(NodeFS.existsSync(engine.modelDir)).toBe(false);
    } finally {
      engine.dispose();
      NodeFS.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it.effect(
    "invalidates local_nmt LRU cache when the model is removed through ReasoningTranslation service",
    () =>
      Effect.gen(function* () {
        const stateDir = makeTempStateDir();
        const manifest = makeTestManifest(TEST_PAYLOADS);
        const localEngine = new LocalNmtEngine({
          stateDir,
          manifest,
          fetchImpl: makeMockManifestFetch(TEST_PAYLOADS),
          runtimeFactory: async () => ({
            translateLines: async (lines) => lines.map((line) => `本地:${line}`),
            dispose: () => {},
          }),
        });

        try {
          yield* Effect.promise(() => localEngine.downloadModel({ mirror: "hf_mirror" }));
          const service = yield* buildService({
            options: { localNmtEngine: localEngine },
          });

          const first = yield* service.translate({
            provider: "local_nmt",
            text: "Checking the file path before applying the fix.",
          });
          expect(first.cached).toBe(false);
          expect(first.modelKey).toBe(LOCAL_NMT_MODEL_ID);
          expect(first.translatedText).toBe("本地:Checking the file path before applying the fix.");

          const cached = yield* service.translate({
            provider: "local_nmt",
            text: "Checking the file path before applying the fix.",
          });
          expect(cached.cached).toBe(true);

          yield* service.removeLocalModel();

          const afterRemove = yield* service
            .translate({
              provider: "local_nmt",
              text: "Checking the file path before applying the fix.",
            })
            .pipe(Effect.flip);
          expect(afterRemove.status).toBe(412);
          expect(afterRemove.code).toBe("LOCAL_NMT_NOT_INSTALLED");
        } finally {
          localEngine.dispose();
          NodeFS.rmSync(stateDir, { recursive: true, force: true });
        }
      }),
  );
});

describe("Engine C: OfficialApiTranslators (all 5 official vendors)", () => {
  it("computes exact Volcano Engine HMAC-SHA256 v4 and Tencent Cloud TC3-HMAC-SHA256 signature vectors", () => {
    const fixedDate = new Date("2026-11-27T08:30:45.000Z");

    // 1. Volcano Engine v4 vector
    const volcanoBody = JSON.stringify({
      TargetLanguage: "zh",
      TextList: ["Checking the file path."],
    });
    const volcanoSigned = signVolcanoRequest({
      accessKeyId: "AKLTTestAccessKey",
      secretAccessKey: "SKTestSecretKey",
      host: "translate.volcengineapi.com",
      path: "/",
      query: "Action=TranslateText&Version=2020-06-01",
      body: volcanoBody,
      region: "cn-north-1",
      service: "translate",
      date: fixedDate,
    });
    const expectedVolcanoBodyHash = sha256(volcanoBody);
    const expectedVolcanoCanonical = [
      "POST",
      "/",
      "Action=TranslateText&Version=2020-06-01",
      `content-type:application/json; charset=utf-8\nhost:translate.volcengineapi.com\nx-content-sha256:${expectedVolcanoBodyHash}\nx-date:20261127T083045Z\n`,
      "content-type;host;x-content-sha256;x-date",
      expectedVolcanoBodyHash,
    ].join("\n");
    const expectedVolcanoScope = "20261127/cn-north-1/translate/request";
    const expectedVolcanoStringToSign = [
      "HMAC-SHA256",
      "20261127T083045Z",
      expectedVolcanoScope,
      sha256(expectedVolcanoCanonical),
    ].join("\n");
    const kDate = hmacSha256("SKTestSecretKey", "20261127");
    const kRegion = hmacSha256(kDate, "cn-north-1");
    const kService = hmacSha256(kRegion, "translate");
    const kSigning = hmacSha256(kService, "request");
    const expectedVolcanoSig = hmacSha256(kSigning, expectedVolcanoStringToSign).toString("hex");

    expect(volcanoSigned.xDate).toBe("20261127T083045Z");
    expect(volcanoSigned.xContentSha256).toBe(expectedVolcanoBodyHash);
    expect(volcanoSigned.signature).toBe(expectedVolcanoSig);
    expect(volcanoSigned.authorization).toBe(
      `HMAC-SHA256 Credential=AKLTTestAccessKey/${expectedVolcanoScope}, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=${expectedVolcanoSig}`,
    );

    // 2. Tencent Cloud TC3-HMAC-SHA256 vector
    const tencentBody = JSON.stringify({
      SourceText: "Checking the file path.",
      Source: "auto",
      Target: "zh",
      ProjectId: 0,
    });
    const tencentSigned = signTencentCloudTc3Request({
      secretId: "AKIDTestSecretId",
      secretKey: "TestTencentSecretKey",
      host: "tmt.tencentcloudapi.com",
      action: "TextTranslate",
      body: tencentBody,
      service: "tmt",
      date: fixedDate,
    });
    const expectedTencentTimestamp = String(Math.floor(fixedDate.getTime() / 1000));
    const expectedTencentCanonical = [
      "POST",
      "/",
      "",
      "content-type:application/json; charset=utf-8\nhost:tmt.tencentcloudapi.com\nx-tc-action:texttranslate\n",
      "content-type;host;x-tc-action",
      sha256(tencentBody),
    ].join("\n");
    const expectedTencentScope = "2026-11-27/tmt/tc3_request";
    const expectedTencentStringToSign = [
      "TC3-HMAC-SHA256",
      expectedTencentTimestamp,
      expectedTencentScope,
      sha256(expectedTencentCanonical),
    ].join("\n");
    const tcDate = hmacSha256("TC3TestTencentSecretKey", "2026-11-27");
    const tcService = hmacSha256(tcDate, "tmt");
    const tcSigning = hmacSha256(tcService, "tc3_request");
    const expectedTencentSig = hmacSha256(tcSigning, expectedTencentStringToSign).toString("hex");

    expect(tencentSigned.timestamp).toBe(expectedTencentTimestamp);
    expect(tencentSigned.signature).toBe(expectedTencentSig);
    expect(tencentSigned.authorization).toBe(
      `TC3-HMAC-SHA256 Credential=AKIDTestSecretId/${expectedTencentScope}, SignedHeaders=content-type;host;x-tc-action, Signature=${expectedTencentSig}`,
    );
  });

  it("enforces HTTPS-only for cloud endpoints and permits loopback HTTP only for OpenAI-compatible", () => {
    expect(
      validateOfficialApiEndpointUrl("https://api.deepl.com/v2/translate", {
        allowLoopbackHttp: false,
      }).href,
    ).toBe("https://api.deepl.com/v2/translate");
    expect(() =>
      validateOfficialApiEndpointUrl("http://api.deepl.com/v2/translate", {
        allowLoopbackHttp: false,
      }),
    ).toThrow(/HTTPS/);
    expect(
      validateOfficialApiEndpointUrl("http://127.0.0.1:11434/v1", {
        allowLoopbackHttp: true,
      }).href,
    ).toBe("http://127.0.0.1:11434/v1");
    expect(() =>
      validateOfficialApiEndpointUrl("http://example.com/v1", {
        allowLoopbackHttp: true,
      }),
    ).toThrow(/localhost/);
  });

  it.effect(
    "translates cleanly via DeepL Free/Pro, Azure, Volcano, Tencent, and OpenAI-compatible endpoints and maps config/auth/quota errors",
    () =>
      Effect.gen(function* () {
        const runVendor = (
          officialApi: Partial<ReasoningTranslationOfficialApiSettings>,
          mockFetch: typeof fetch,
        ) =>
          buildService({
            settings: {
              reasoningTranslationOfficialApi: {
                vendor: "openai_compatible",
                apiKey: "",
                apiSecret: "",
                region: "",
                endpoint: "",
                model: "",
                ...officialApi,
              },
            },
            options: {
              fetchImpl: mockFetch,
              now: () => new Date("2026-11-27T08:30:45.000Z"),
            },
          });

        // 1. DeepL Free (:fx key) & Pro routing
        const deeplCalls: Array<{
          readonly url: string;
          readonly headers: Record<string, string>;
          readonly body: unknown;
        }> = [];
        const deeplFetch = (async (input: string | URL | Request, init?: RequestInit) => {
          deeplCalls.push({
            url: String(input),
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: JSON.parse(String(init?.body ?? "{}")),
          });
          return new Response(
            JSON.stringify({ translations: [{ text: "检查 PMX000Z 中的路径。" }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }) as typeof fetch;

        const deeplFreeSvc = yield* runVendor(
          { vendor: "deepl", apiKey: "deepl-key:fx" },
          deeplFetch,
        );
        const deeplFreeRes = yield* deeplFreeSvc.translate({
          provider: "official_api",
          text: "Check path in `http.ts`.",
        });
        expect(deeplFreeRes.translatedText).toBe("检查 `http.ts` 中的路径。");
        expect(deeplCalls[0]?.url).toBe(DEFAULT_DEEPL_FREE_URL);
        expect(deeplCalls[0]?.headers.Authorization).toBe("DeepL-Auth-Key deepl-key:fx");

        const deeplProSvc = yield* runVendor(
          { vendor: "deepl", apiKey: "deepl-pro-key" },
          deeplFetch,
        );
        yield* deeplProSvc.translate({ provider: "official_api", text: "Check Pro endpoint." });
        expect(deeplCalls[1]?.url).toBe(DEFAULT_DEEPL_PRO_URL);

        // 2. Azure Translator
        const azureCalls: Array<{
          readonly url: string;
          readonly headers: Record<string, string>;
          readonly body: unknown;
        }> = [];
        const azureSvc = yield* runVendor(
          { vendor: "azure", apiKey: "azure-sub-key", region: "eastasia" },
          (async (input: string | URL | Request, init?: RequestInit) => {
            azureCalls.push({
              url: String(input),
              headers: (init?.headers ?? {}) as Record<string, string>,
              body: JSON.parse(String(init?.body ?? "[]")),
            });
            return new Response(JSON.stringify([{ translations: [{ text: "Azure 译文" }] }]), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }) as typeof fetch,
        );
        const azureRes = yield* azureSvc.translate({
          provider: "official_api",
          text: "Checking Azure route.",
        });
        expect(azureRes.translatedText).toBe("Azure 译文");
        expect(azureCalls[0]?.url).toBe(
          `${DEFAULT_AZURE_TRANSLATOR_ENDPOINT}/translate?api-version=3.0&to=zh-Hans`,
        );
        expect(azureCalls[0]?.headers["Ocp-Apim-Subscription-Key"]).toBe("azure-sub-key");
        expect(azureCalls[0]?.headers["Ocp-Apim-Subscription-Region"]).toBe("eastasia");

        // 3. Volcano Engine TranslateText
        const volcanoCalls: Array<{
          readonly url: string;
          readonly headers: Record<string, string>;
          readonly body: unknown;
        }> = [];
        const volcanoSvc = yield* runVendor(
          { vendor: "volcano", apiKey: "ak-volc", apiSecret: "sk-volc", region: "cn-north-1" },
          (async (input: string | URL | Request, init?: RequestInit) => {
            volcanoCalls.push({
              url: String(input),
              headers: (init?.headers ?? {}) as Record<string, string>,
              body: JSON.parse(String(init?.body ?? "{}")),
            });
            return new Response(
              JSON.stringify({ TranslationList: [{ Translation: "火山引擎译文" }] }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }) as typeof fetch,
        );
        const volcanoRes = yield* volcanoSvc.translate({
          provider: "official_api",
          text: "Checking Volcano request.",
        });
        expect(volcanoRes.translatedText).toBe("火山引擎译文");
        expect(volcanoCalls[0]?.url).toBe(
          `${DEFAULT_VOLCANO_TRANSLATE_ENDPOINT}?Action=TranslateText&Version=2020-06-01`,
        );
        expect(volcanoCalls[0]?.headers.Authorization).toMatch(
          /^HMAC-SHA256 Credential=ak-volc\/20261127\/cn-north-1\/translate\/request,/,
        );

        // 4. Tencent Cloud TMT
        const tencentCalls: Array<{
          readonly url: string;
          readonly headers: Record<string, string>;
          readonly body: unknown;
        }> = [];
        const tencentSvc = yield* runVendor(
          { vendor: "tencent", apiKey: "id-tc", apiSecret: "key-tc", region: "ap-shanghai" },
          (async (input: string | URL | Request, init?: RequestInit) => {
            tencentCalls.push({
              url: String(input),
              headers: (init?.headers ?? {}) as Record<string, string>,
              body: JSON.parse(String(init?.body ?? "{}")),
            });
            return new Response(JSON.stringify({ Response: { TargetText: "腾讯云译文" } }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }) as typeof fetch,
        );
        const tencentRes = yield* tencentSvc.translate({
          provider: "official_api",
          text: "Checking Tencent TMT.",
        });
        expect(tencentRes.translatedText).toBe("腾讯云译文");
        expect(tencentCalls[0]?.url).toBe(DEFAULT_TENCENT_TMT_ENDPOINT);
        expect(tencentCalls[0]?.headers["X-TC-Action"]).toBe("TextTranslate");
        expect(tencentCalls[0]?.headers["X-TC-Version"]).toBe("2018-03-21");
        expect(tencentCalls[0]?.headers["X-TC-Region"]).toBe("ap-shanghai");
        expect(tencentCalls[0]?.headers.Authorization).toMatch(
          /^TC3-HMAC-SHA256 Credential=id-tc\/2026-11-27\/tmt\/tc3_request,/,
        );

        // 5. OpenAI-compatible local Ollama (no key required on 127.0.0.1) + <think> stripping
        const openaiCalls: Array<{
          readonly url: string;
          readonly headers: Record<string, string>;
          readonly body: unknown;
        }> = [];
        const openaiSvc = yield* runVendor(
          {
            vendor: "openai_compatible",
            endpoint: "http://127.0.0.1:11434/v1",
            model: "qwen2.5:7b",
            apiKey: "",
          },
          (async (input: string | URL | Request, init?: RequestInit) => {
            openaiCalls.push({
              url: String(input),
              headers: (init?.headers ?? {}) as Record<string, string>,
              body: JSON.parse(String(init?.body ?? "{}")),
            });
            return new Response(
              JSON.stringify({
                choices: [
                  { message: { content: "<think>internal</think>在应用修复前先检查文件路径。" } },
                ],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          }) as typeof fetch,
        );
        const openaiRes = yield* openaiSvc.translate({
          provider: "official_api",
          text: REASONING_TRANSLATION_TEST_SAMPLE_TEXT,
        });
        expect(openaiRes.translatedText).toBe("在应用修复前先检查文件路径。");
        expect(openaiRes.modelKey).toBe("openai_compatible:qwen2.5:7b");
        expect(openaiCalls[0]?.url).toBe("http://127.0.0.1:11434/v1/chat/completions");
        expect(openaiCalls[0]?.headers.Authorization).toBeUndefined();

        // Missing configuration returns structured OFFICIAL_API_NOT_CONFIGURED (400).
        const unconfiguredSvc = yield* runVendor({ vendor: "deepl", apiKey: "" }, deeplFetch);
        const missingErr = yield* unconfiguredSvc
          .translate({ provider: "official_api", text: "Missing key test" })
          .pipe(Effect.flip);
        expect(missingErr.status).toBe(400);
        expect(missingErr.code).toBe("OFFICIAL_API_NOT_CONFIGURED");

        // Quota error (DeepL 456) maps cleanly to 429 OFFICIAL_API_RATE_LIMITED.
        const quotaSvc = yield* runVendor(
          { vendor: "deepl", apiKey: "key:fx" },
          (async () =>
            new Response(JSON.stringify({ message: "Quota exceeded" }), {
              status: 456,
            })) as typeof fetch,
        );
        const quotaErr = yield* quotaSvc
          .translate({ provider: "official_api", text: "Quota exceeded test" })
          .pipe(Effect.flip);
        expect(quotaErr.status).toBe(429);
        expect(quotaErr.code).toBe("OFFICIAL_API_RATE_LIMITED");
      }),
  );
});

describe("Reasoning translation HTTP routes", () => {
  it("serves all 6 routes, authenticates & enforces scopes, rejects bing/google, and allows CORS DELETE", async () => {
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

    let currentStatus: LocalNmtModelStatus = {
      installed: false,
      downloading: false,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: 1000,
      modelId: LOCAL_NMT_MODEL_ID,
      modelDir: "/tmp/models/reasoning-translate/mozilla-bergamot-enzh-v2.2",
      mirror: "hf_mirror",
      version: "2.2.0",
      error: null,
      sizeBytes: 0,
    };

    const layerTranslation = Layer.succeed(
      ReasoningTranslation,
      ReasoningTranslation.of({
        translate: (input) =>
          Effect.succeed({
            translatedText: `ZH(${input.provider}):${input.text}`,
            provider: input.provider,
            cached: false,
            modelKey: input.provider === "local_nmt" ? LOCAL_NMT_MODEL_ID : "mock-model",
          }),
        getLocalModelStatus: () => Effect.succeed(currentStatus),
        startLocalModelDownload: (req) =>
          Effect.sync(() => {
            currentStatus = {
              ...currentStatus,
              downloading: true,
              progressPercent: 25,
              downloadedBytes: 250,
              mirror: req?.mirror ?? currentStatus.mirror,
            };
            return currentStatus;
          }),
        cancelLocalModelDownload: () =>
          Effect.sync(() => {
            currentStatus = {
              ...currentStatus,
              downloading: false,
              progressPercent: 0,
              downloadedBytes: 0,
            };
            return currentStatus;
          }),
        removeLocalModel: () =>
          Effect.sync(() => {
            currentStatus = {
              ...currentStatus,
              installed: false,
              downloading: false,
              progressPercent: 0,
              downloadedBytes: 0,
              sizeBytes: 0,
            };
            return currentStatus;
          }),
        testProvider: (req) =>
          Effect.succeed(
            req.provider === "local_nmt" && !currentStatus.installed
              ? {
                  ok: false,
                  translatedText: null,
                  latencyMs: 2,
                  provider: req.provider,
                  modelKey: null,
                  error: "Local offline NMT model is not installed yet.",
                  errorCode: "LOCAL_NMT_NOT_INSTALLED",
                }
              : {
                  ok: true,
                  translatedText: "在应用修复前先检查文件路径。",
                  latencyMs: 12,
                  provider: req.provider,
                  modelKey: "mock-model",
                  error: null,
                  errorCode: null,
                },
          ),
      }),
    );

    const layerApp = Layer.merge(
      ServerHttp.layerReasoningTranslationRoute,
      ServerHttp.layerBrowserApiCors,
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          layerAuth,
          layerTranslation,
          ServerConfig.layerTest(process.cwd(), { prefix: "reasoning-http-route-test-" }).pipe(
            Layer.provide(NodeServices.layer),
          ),
        ),
      ),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(layerApp, { disableLogger: true });

    try {
      // 1. POST /api/reasoning/translate supports all 3 compliant providers.
      for (const provider of ["local_nmt", "text_model", "official_api"] as const) {
        const res = await handler(
          new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATE_PATH}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer valid-token",
            },
            body: JSON.stringify({ provider, text: "Plan next edit" }),
          }),
        );
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
          translatedText: `ZH(${provider}):Plan next edit`,
          provider,
          cached: false,
        });
      }

      // Removed unofficial bing/google providers remain rejected with 400.
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

      // Read-only scope allows local_nmt but forbids text_model and official_api.
      const readOnlyLocal = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATE_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer read-only",
          },
          body: JSON.stringify({ provider: "local_nmt", text: "Check code" }),
        }),
      );
      expect(readOnlyLocal.status).toBe(200);

      for (const operateOnlyProvider of ["text_model", "official_api"]) {
        const forbidden = await handler(
          new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATE_PATH}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer read-only",
            },
            body: JSON.stringify({ provider: operateOnlyProvider, text: "Check code" }),
          }),
        );
        expect(forbidden.status).toBe(403);
      }

      // 2. GET /api/reasoning/translation/local-model/status
      const statusRes = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATION_LOCAL_MODEL_STATUS_PATH}`, {
          method: "GET",
          headers: { authorization: "Bearer read-only" },
        }),
      );
      expect(statusRes.status).toBe(200);
      expect(await statusRes.json()).toMatchObject({
        installed: false,
        downloading: false,
        modelId: LOCAL_NMT_MODEL_ID,
      });

      // 3. POST /api/reasoning/translation/local-model/download
      const downloadRes = await handler(
        new Request(
          `http://127.0.0.1${ServerHttp.REASONING_TRANSLATION_LOCAL_MODEL_DOWNLOAD_PATH}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer valid-token",
            },
            body: JSON.stringify({ mirror: "huggingface" }),
          },
        ),
      );
      expect(downloadRes.status).toBe(202);
      expect(await downloadRes.json()).toMatchObject({
        downloading: true,
        progressPercent: 25,
        mirror: "huggingface",
      });

      // 4. POST /api/reasoning/translation/local-model/cancel
      const cancelRes = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATION_LOCAL_MODEL_CANCEL_PATH}`, {
          method: "POST",
          headers: { authorization: "Bearer valid-token" },
        }),
      );
      expect(cancelRes.status).toBe(200);
      expect(await cancelRes.json()).toMatchObject({
        downloading: false,
        progressPercent: 0,
      });

      // 5. DELETE /api/reasoning/translation/local-model + CORS preflight
      const corsDelete = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATION_LOCAL_MODEL_PATH}`, {
          method: "OPTIONS",
          headers: {
            origin: "prismux://app",
            "access-control-request-method": "DELETE",
            "access-control-request-headers": "authorization",
          },
        }),
      );
      expect(corsDelete.status).toBe(204);
      expect(corsDelete.headers.get("access-control-allow-methods")).toContain("DELETE");

      const deleteRes = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATION_LOCAL_MODEL_PATH}`, {
          method: "DELETE",
          headers: { authorization: "Bearer valid-token" },
        }),
      );
      expect(deleteRes.status).toBe(200);
      expect(await deleteRes.json()).toMatchObject({
        installed: false,
        sizeBytes: 0,
      });

      // 6. POST /api/reasoning/translation/test (both ok and structured failure)
      const testOkRes = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATION_TEST_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer valid-token",
          },
          body: JSON.stringify({ provider: "official_api" }),
        }),
      );
      expect(testOkRes.status).toBe(200);
      expect(await testOkRes.json()).toEqual({
        ok: true,
        translatedText: "在应用修复前先检查文件路径。",
        latencyMs: 12,
        provider: "official_api",
        modelKey: "mock-model",
        error: null,
        errorCode: null,
      });

      const testFailRes = await handler(
        new Request(`http://127.0.0.1${ServerHttp.REASONING_TRANSLATION_TEST_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer valid-token",
          },
          body: JSON.stringify({ provider: "local_nmt" }),
        }),
      );
      expect(testFailRes.status).toBe(200);
      expect(await testFailRes.json()).toMatchObject({
        ok: false,
        translatedText: null,
        provider: "local_nmt",
        errorCode: "LOCAL_NMT_NOT_INSTALLED",
      });
    } finally {
      await dispose();
    }
  });
});
