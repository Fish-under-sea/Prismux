import { ReasoningTranslationLocalModelMirror, type ModelSelection } from "@prismux/core-contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  LocalNmtEngine,
  LocalNmtError,
  type LocalNmtEngineOptions,
  type LocalNmtModelStatus,
} from "./LocalNmtEngine.ts";
import {
  OFFICIAL_API_TIMEOUT_MS,
  OfficialApiTranslationError,
  computeOfficialApiCacheFingerprint,
  computeOfficialApiModelKey,
  translateWithOfficialApi,
} from "./OfficialApiTranslators.ts";

export {
  DEFAULT_LOCAL_NMT_MANIFEST,
  LOCAL_NMT_DEFAULT_IDLE_UNLOAD_MS,
  LOCAL_NMT_MODEL_ID,
  LOCAL_NMT_MODEL_VERSION,
  LocalNmtEngine,
  LocalNmtError,
  type LocalNmtEngineOptions,
  type LocalNmtManifestFile,
  type LocalNmtModelStatus,
  type LocalNmtRuntimeFactory,
  type LocalNmtRuntimeInstance,
} from "./LocalNmtEngine.ts";
export {
  DEFAULT_AZURE_TRANSLATOR_ENDPOINT,
  DEFAULT_DEEPL_FREE_URL,
  DEFAULT_DEEPL_PRO_URL,
  DEFAULT_OPENAI_COMPATIBLE_ENDPOINT,
  DEFAULT_TENCENT_TMT_ENDPOINT,
  DEFAULT_VOLCANO_TRANSLATE_ENDPOINT,
  OFFICIAL_API_TIMEOUT_MS,
  OfficialApiTranslationError,
  computeOfficialApiCacheFingerprint,
  computeOfficialApiModelKey,
  signTencentCloudTc3Request,
  signVolcanoRequest,
  translateWithOfficialApi,
  validateOfficialApiEndpointUrl,
} from "./OfficialApiTranslators.ts";

export const REASONING_TRANSLATION_MAX_TEXT_CHARS = 4_000;
export const REASONING_TRANSLATION_CACHE_MAX_ENTRIES = 500;
export const TEXT_MODEL_TIMEOUT_MS = 45_000;
export const LOCAL_NMT_TIMEOUT_MS = 30_000;
export const REASONING_TRANSLATION_TEST_SAMPLE_TEXT =
  "Checking the file path before applying the fix.";

export const ReasoningTranslationRequestProvider = Schema.Literals([
  "local_nmt",
  "text_model",
  "official_api",
]);
export type ReasoningTranslationRequestProvider = typeof ReasoningTranslationRequestProvider.Type;

export const ReasoningTranslationRequest = Schema.Struct({
  provider: ReasoningTranslationRequestProvider,
  text: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(REASONING_TRANSLATION_MAX_TEXT_CHARS),
  ),
  targetLanguage: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(32))),
  sourceLanguage: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(32))),
});
export type ReasoningTranslationRequest = typeof ReasoningTranslationRequest.Type;

export const ReasoningTranslationLocalModelDownloadRequest = Schema.Struct({
  mirror: Schema.optionalKey(ReasoningTranslationLocalModelMirror),
});
export type ReasoningTranslationLocalModelDownloadRequest =
  typeof ReasoningTranslationLocalModelDownloadRequest.Type;

export const ReasoningTranslationTestRequest = Schema.Struct({
  provider: ReasoningTranslationRequestProvider,
  text: Schema.optionalKey(
    Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(REASONING_TRANSLATION_MAX_TEXT_CHARS),
    ),
  ),
  targetLanguage: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(32))),
  sourceLanguage: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(32))),
});
export type ReasoningTranslationTestRequest = typeof ReasoningTranslationTestRequest.Type;

export interface ReasoningTranslationResult {
  readonly translatedText: string;
  readonly provider: ReasoningTranslationRequestProvider;
  readonly cached: boolean;
  readonly modelKey?: string;
}

export interface ReasoningTranslationTestResult {
  readonly ok: boolean;
  readonly translatedText: string | null;
  readonly latencyMs: number;
  readonly provider: ReasoningTranslationRequestProvider;
  readonly modelKey: string | null;
  readonly error: string | null;
  readonly errorCode: string | null;
}

export class ReasoningTranslationError extends Schema.TaggedError<ReasoningTranslationError>()(
  "ReasoningTranslationError",
  {
    status: Schema.Number,
    code: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface ReasoningTranslationService {
  readonly translate: (
    request: ReasoningTranslationRequest,
    options?: { readonly skipCache?: boolean },
  ) => Effect.Effect<ReasoningTranslationResult, ReasoningTranslationError>;
  readonly getLocalModelStatus: () => Effect.Effect<LocalNmtModelStatus, ReasoningTranslationError>;
  readonly startLocalModelDownload: (
    request?: ReasoningTranslationLocalModelDownloadRequest,
  ) => Effect.Effect<LocalNmtModelStatus, ReasoningTranslationError>;
  readonly cancelLocalModelDownload: () => Effect.Effect<
    LocalNmtModelStatus,
    ReasoningTranslationError
  >;
  readonly removeLocalModel: () => Effect.Effect<LocalNmtModelStatus, ReasoningTranslationError>;
  readonly testProvider: (
    request: ReasoningTranslationTestRequest,
  ) => Effect.Effect<ReasoningTranslationTestResult>;
}

export class ReasoningTranslation extends Context.Service<
  ReasoningTranslation,
  ReasoningTranslationService
>()("@prismux/server/reasoningTranslation/ReasoningTranslation") {}

export interface ReasoningTranslationOptions {
  readonly maxCacheEntries?: number;
  readonly textModelTimeoutMs?: number;
  readonly localNmtTimeoutMs?: number;
  readonly officialApiTimeoutMs?: number;
  readonly localNmtEngine?: LocalNmtEngine;
  readonly localNmtOptions?: Omit<LocalNmtEngineOptions, "stateDir"> & {
    readonly stateDir?: string;
  };
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

class LruCache<V> {
  private readonly entries = new Map<string, V>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: string): V | undefined {
    const existing = this.entries.get(key);
    if (existing === undefined) return undefined;
    // Refresh recency for LRU ordering.
    this.entries.delete(key);
    this.entries.set(key, existing);
    return existing;
  }

  set(key: string, value: V): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(key, value);
  }

  deleteWhere(predicate: (key: string) => boolean): void {
    for (const key of this.entries.keys()) {
      if (predicate(key)) {
        this.entries.delete(key);
      }
    }
  }
}

const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const URL_RE = /https?:\/\/\S+/gi;
const WINDOWS_PATH_RE = /\b[A-Za-z]:[\\/][^\s'"`)\],;]+/g;
const SLASH_PATH_RE = /(?:~\/|\.\.?\/|\/)?(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+/g;
const CODE_FILENAME_RE =
  /\b[A-Za-z0-9_-]+\.(?:tsx?|jsx?|mjs|cjs|json|css|scss|html|md|yml|yaml|toml|rs|py|go|sh|ps1|sql|env|lock|txt)\b/gi;
const SNAKE_IDENTIFIER_RE = /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g;
const CAMEL_IDENTIFIER_RE = /\b[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*\b/g;
const CLI_FLAG_RE = /(?:^|\s)--?[A-Za-z0-9][A-Za-z0-9-]*/g;
const HAN_CHAR_RE = /\p{Script=Han}/gu;
const LATIN_LETTER_RE = /[A-Za-z]/g;

function stripTechnicalTokens(text: string): string {
  return text
    .replace(FENCED_CODE_BLOCK_RE, " ")
    .replace(INLINE_CODE_RE, " ")
    .replace(URL_RE, " ")
    .replace(WINDOWS_PATH_RE, " ")
    .replace(SLASH_PATH_RE, " ")
    .replace(CODE_FILENAME_RE, " ")
    .replace(SNAKE_IDENTIFIER_RE, " ")
    .replace(CAMEL_IDENTIFIER_RE, " ")
    .replace(CLI_FLAG_RE, " ");
}

/**
 * Returns true when reasoning prose is already naturally written in Chinese (or contains no
 * translatable Latin prose after stripping fenced/inline code, URLs, file paths, and identifiers).
 */
export function isAlreadyChineseReasoning(text: string): boolean {
  if (text.trim().length === 0) return true;
  const stripped = stripTechnicalTokens(text);
  const latinCount = stripped.match(LATIN_LETTER_RE)?.length ?? 0;
  if (latinCount === 0) return true;
  const hanCount = stripped.match(HAN_CHAR_RE)?.length ?? 0;
  if (hanCount < 4) return false;
  return hanCount / (hanCount + latinCount) >= 0.35;
}

export function shouldSkipReasoningTranslation(
  text: string,
  targetLanguage?: string | undefined,
): boolean {
  if (text.trim().length === 0) return true;
  const normalizedTarget = targetLanguage?.trim().toLowerCase() ?? "";
  const isChineseTarget =
    normalizedTarget === "" ||
    normalizedTarget === "auto" ||
    normalizedTarget === "zh" ||
    normalizedTarget.startsWith("zh-");
  if (!isChineseTarget) return false;
  return isAlreadyChineseReasoning(text);
}

export function normalizeSourceLanguage(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "auto") return "auto";
  return trimmed;
}

export function normalizeTargetLanguage(
  _provider: ReasoningTranslationRequestProvider,
  value: string | undefined,
): string {
  const trimmed = value?.trim();
  const lowered = trimmed?.toLowerCase();
  if (!lowered || lowered === "zh" || lowered === "zh-cn" || lowered === "zh-hans") {
    return "zh-Hans";
  }
  return trimmed!;
}

const encodeStringArrayJson = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const makeCacheKey = (
  provider: ReasoningTranslationRequestProvider,
  fingerprint: string,
  sourceLanguage: string,
  targetLanguage: string,
  text: string,
): string => encodeStringArrayJson([provider, fingerprint, sourceLanguage, targetLanguage, text]);

function mapLocalNmtError(cause: unknown): ReasoningTranslationError {
  if (cause instanceof LocalNmtError) {
    return new ReasoningTranslationError({
      status: cause.status,
      code: cause.code,
      detail: cause.message,
      cause,
    });
  }
  return new ReasoningTranslationError({
    status: 500,
    code: "LOCAL_NMT_FAILED",
    detail: cause instanceof Error ? cause.message : "Local offline NMT translation failed.",
    cause,
  });
}

function mapOfficialApiError(cause: unknown): ReasoningTranslationError {
  if (cause instanceof OfficialApiTranslationError) {
    return new ReasoningTranslationError({
      status: cause.status,
      code: cause.code,
      detail: cause.message,
      cause,
    });
  }
  return new ReasoningTranslationError({
    status: 502,
    code: "OFFICIAL_API_UPSTREAM_ERROR",
    detail: cause instanceof Error ? cause.message : "Official translation API request failed.",
    cause,
  });
}

export const make = Effect.fn("ReasoningTranslation.make")(function* (
  options: ReasoningTranslationOptions = {},
) {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;
  const serverConfigOption = yield* Effect.serviceOption(ServerConfig.ServerConfig);

  const maxCacheEntries = options.maxCacheEntries ?? REASONING_TRANSLATION_CACHE_MAX_ENTRIES;
  const textModelTimeoutMs = options.textModelTimeoutMs ?? TEXT_MODEL_TIMEOUT_MS;
  const localNmtTimeoutMs = options.localNmtTimeoutMs ?? LOCAL_NMT_TIMEOUT_MS;
  const officialApiTimeoutMs = options.officialApiTimeoutMs ?? OFFICIAL_API_TIMEOUT_MS;
  const cache = new LruCache<string>(maxCacheEntries);

  const resolvedStateDir =
    options.localNmtOptions?.stateDir ??
    Option.getOrUndefined(serverConfigOption)?.stateDir ??
    (yield* fileSystem
      .makeTempDirectoryScoped({ prefix: "prismux-local-nmt-" })
      .pipe(Effect.orDie));

  const ownsLocalNmtEngine = options.localNmtEngine === undefined;
  const localNmtEngine =
    options.localNmtEngine ??
    new LocalNmtEngine({
      ...options.localNmtOptions,
      stateDir: resolvedStateDir,
      ...(options.fetchImpl && !options.localNmtOptions?.fetchImpl
        ? { fetchImpl: options.fetchImpl }
        : {}),
    });

  if (ownsLocalNmtEngine) {
    yield* Effect.addFinalizer(() => Effect.sync(() => localNmtEngine.dispose()));
  }

  const readSettings = serverSettings.getSettings.pipe(
    Effect.mapError(
      (cause) =>
        new ReasoningTranslationError({
          status: 500,
          code: "SETTINGS_UNAVAILABLE",
          detail: "Couldn't read reasoning translation settings.",
          cause,
        }),
    ),
  );

  const translateWithTextModel = Effect.fn("ReasoningTranslation.translateWithTextModel")(
    function* (
      text: string,
      sourceLanguage: string,
      targetLanguage: string,
      modelSelection: ModelSelection,
    ) {
      // Providers run in a working directory; reasoning translation must never touch a user checkout.
      const cwd = yield* fileSystem
        .makeTempDirectoryScoped({ prefix: "prismux-cot-translate-" })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ReasoningTranslationError({
                status: 500,
                code: "TRANSLATION_TEMP_DIR_FAILED",
                detail: "Failed to prepare temporary directory for reasoning translation.",
                cause,
              }),
          ),
        );
      const generated = yield* TextGeneration.translateReasoningWithService(textGeneration, {
        cwd,
        text,
        sourceLanguage,
        targetLanguage,
        modelSelection,
      }).pipe(
        Effect.mapError((error) => {
          const isComplianceBlocked = error.detail.includes(
            "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED",
          );
          return new ReasoningTranslationError({
            status: isComplianceBlocked ? 403 : 502,
            code: isComplianceBlocked
              ? "ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED"
              : "TRANSLATION_MODEL_FAILED",
            detail: error.detail,
            cause: error,
          });
        }),
      );
      const translatedText = generated.translatedText.trim();
      if (translatedText.length === 0) {
        return yield* new ReasoningTranslationError({
          status: 502,
          code: "TRANSLATION_MODEL_EMPTY",
          detail: "The configured text generation model returned an empty translation.",
        });
      }
      return translatedText;
    },
    Effect.scoped,
  );

  const withTimeout = <A>(
    effect: Effect.Effect<A, ReasoningTranslationError>,
    timeoutMs: number,
  ): Effect.Effect<A, ReasoningTranslationError> =>
    effect.pipe(
      Effect.timeoutOption(timeoutMs),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ReasoningTranslationError({
                status: 504,
                code: "TRANSLATION_TIMEOUT",
                detail: `Reasoning translation timed out after ${Math.round(timeoutMs / 1000)}s.`,
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const translate: ReasoningTranslationService["translate"] = Effect.fn(
    "ReasoningTranslation.translate",
  )(function* (request, translateOptions) {
    if (request.text.length > REASONING_TRANSLATION_MAX_TEXT_CHARS) {
      return yield* new ReasoningTranslationError({
        status: 400,
        code: "INVALID_REQUEST",
        detail: `Reasoning text exceeds maximum length of ${REASONING_TRANSLATION_MAX_TEXT_CHARS} characters.`,
      });
    }
    if (request.text.trim().length === 0) {
      return {
        translatedText: request.text,
        provider: request.provider,
        cached: false,
      };
    }

    const sourceLanguage = normalizeSourceLanguage(request.sourceLanguage);
    const targetLanguage = normalizeTargetLanguage(request.provider, request.targetLanguage);
    if (shouldSkipReasoningTranslation(request.text, targetLanguage)) {
      return {
        translatedText: request.text,
        provider: request.provider,
        cached: false,
      };
    }

    const settings = yield* readSettings;

    let modelKey: string;
    let cacheFingerprint: string;
    let executeTranslation: Effect.Effect<string, ReasoningTranslationError>;

    if (request.provider === "text_model") {
      // Engine A: dedicated reasoning translation model override, falling back to textGenerationModelSelection.
      const modelSelection =
        settings.reasoningTranslationModelSelection ?? settings.textGenerationModelSelection;
      modelKey = `${modelSelection.instanceId}:${modelSelection.model}`;
      cacheFingerprint = modelKey;
      executeTranslation = withTimeout(
        translateWithTextModel(request.text, sourceLanguage, targetLanguage, modelSelection),
        textModelTimeoutMs,
      );
    } else if (request.provider === "local_nmt") {
      // Engine B: pure local offline NMT (Mozilla Bergamot WASM en->zh-Hans).
      modelKey = localNmtEngine.modelId;
      cacheFingerprint = `${localNmtEngine.modelId}:${localNmtEngine.version}`;
      executeTranslation = withTimeout(
        Effect.tryPromise({
          try: () => localNmtEngine.translate(request.text, sourceLanguage, targetLanguage),
          catch: mapLocalNmtError,
        }),
        localNmtTimeoutMs,
      );
    } else {
      // Engine C: official user-keyed translation API (DeepL / Azure / Volcano / Tencent / OpenAI-compatible).
      const officialApi = settings.reasoningTranslationOfficialApi;
      modelKey = computeOfficialApiModelKey(officialApi);
      cacheFingerprint = computeOfficialApiCacheFingerprint(officialApi);
      executeTranslation = Effect.tryPromise({
        try: () =>
          translateWithOfficialApi({
            config: officialApi,
            text: request.text,
            sourceLanguage,
            targetLanguage,
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
            timeoutMs: officialApiTimeoutMs,
            ...(options.now ? { now: options.now } : {}),
          }).then((result) => result.translatedText),
        catch: mapOfficialApiError,
      });
    }

    const cacheKey = makeCacheKey(
      request.provider,
      cacheFingerprint,
      sourceLanguage,
      targetLanguage,
      request.text,
    );

    if (!translateOptions?.skipCache) {
      const cachedValue = cache.get(cacheKey);
      if (cachedValue !== undefined) {
        return {
          translatedText: cachedValue,
          provider: request.provider,
          cached: true,
          modelKey,
        };
      }
    }

    const translatedText = yield* executeTranslation;

    if (!translateOptions?.skipCache) {
      cache.set(cacheKey, translatedText);
    }
    return {
      translatedText,
      provider: request.provider,
      cached: false,
      modelKey,
    };
  });

  const getLocalModelStatus: ReasoningTranslationService["getLocalModelStatus"] = Effect.fn(
    "ReasoningTranslation.getLocalModelStatus",
  )(function* () {
    const settings = yield* readSettings;
    return localNmtEngine.getStatus(settings.reasoningTranslationLocalModelMirror);
  });

  const startLocalModelDownload: ReasoningTranslationService["startLocalModelDownload"] = Effect.fn(
    "ReasoningTranslation.startLocalModelDownload",
  )(function* (request) {
    const settings = yield* readSettings;
    const mirror = request?.mirror ?? settings.reasoningTranslationLocalModelMirror;
    return localNmtEngine.startDownload({ mirror });
  });

  const cancelLocalModelDownload: ReasoningTranslationService["cancelLocalModelDownload"] =
    Effect.fn("ReasoningTranslation.cancelLocalModelDownload")(function* () {
      return yield* Effect.tryPromise({
        try: () => localNmtEngine.cancelDownload(),
        catch: mapLocalNmtError,
      });
    });

  const removeLocalModel: ReasoningTranslationService["removeLocalModel"] = Effect.fn(
    "ReasoningTranslation.removeLocalModel",
  )(function* () {
    cache.deleteWhere((key) => key.startsWith('["local_nmt",'));
    return yield* Effect.tryPromise({
      try: () => localNmtEngine.removeModel(),
      catch: mapLocalNmtError,
    });
  });

  const testProvider: ReasoningTranslationService["testProvider"] = Effect.fn(
    "ReasoningTranslation.testProvider",
  )(function* (request) {
    const startedAt = yield* Clock.currentTimeMillis;
    const sampleText = request.text?.trim() || REASONING_TRANSLATION_TEST_SAMPLE_TEXT;
    return yield* translate(
      {
        provider: request.provider,
        text: sampleText,
        ...(request.sourceLanguage !== undefined ? { sourceLanguage: request.sourceLanguage } : {}),
        ...(request.targetLanguage !== undefined ? { targetLanguage: request.targetLanguage } : {}),
      },
      { skipCache: true },
    ).pipe(
      Effect.flatMap((result) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((finishedAt): ReasoningTranslationTestResult => ({
            ok: true,
            translatedText: result.translatedText,
            latencyMs: Math.max(0, finishedAt - startedAt),
            provider: result.provider,
            modelKey: result.modelKey ?? null,
            error: null,
            errorCode: null,
          })),
        ),
      ),
      Effect.catch((error: ReasoningTranslationError) =>
        Clock.currentTimeMillis.pipe(
          Effect.map((finishedAt): ReasoningTranslationTestResult => ({
            ok: false,
            translatedText: null,
            latencyMs: Math.max(0, finishedAt - startedAt),
            provider: request.provider,
            modelKey: null,
            error: error.detail,
            errorCode: error.code,
          })),
        ),
      ),
    );
  });

  return ReasoningTranslation.of({
    translate,
    getLocalModelStatus,
    startLocalModelDownload,
    cancelLocalModelDownload,
    removeLocalModel,
    testProvider,
  });
});

export const layer = Layer.effect(ReasoningTranslation, make());
