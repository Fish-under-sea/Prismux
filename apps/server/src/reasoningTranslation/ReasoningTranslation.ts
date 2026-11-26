import type { ModelSelection } from "@prismux/core-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export const REASONING_TRANSLATION_MAX_TEXT_CHARS = 4_000;
export const REASONING_TRANSLATION_CACHE_MAX_ENTRIES = 500;
export const TEXT_MODEL_TIMEOUT_MS = 45_000;

export const ReasoningTranslationRequestProvider = Schema.Literals(["text_model"]);
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

export interface ReasoningTranslationResult {
  readonly translatedText: string;
  readonly provider: ReasoningTranslationRequestProvider;
  readonly cached: boolean;
  readonly modelKey?: string;
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
  ) => Effect.Effect<ReasoningTranslationResult, ReasoningTranslationError>;
}

export class ReasoningTranslation extends Context.Service<
  ReasoningTranslation,
  ReasoningTranslationService
>()("@prismux/server/reasoningTranslation/ReasoningTranslation") {}

export interface ReasoningTranslationOptions {
  readonly maxCacheEntries?: number;
  readonly textModelTimeoutMs?: number;
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

const encodeStringArrayJson = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

const makeCacheKey = (
  provider: ReasoningTranslationRequestProvider,
  modelKey: string,
  sourceLanguage: string,
  targetLanguage: string,
  text: string,
): string => encodeStringArrayJson([provider, modelKey, sourceLanguage, targetLanguage, text]);

export const make = Effect.fn("ReasoningTranslation.make")(function* (
  options: ReasoningTranslationOptions = {},
) {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fileSystem = yield* FileSystem.FileSystem;

  const maxCacheEntries = options.maxCacheEntries ?? REASONING_TRANSLATION_CACHE_MAX_ENTRIES;
  const textModelTimeoutMs = options.textModelTimeoutMs ?? TEXT_MODEL_TIMEOUT_MS;
  const cache = new LruCache<string>(maxCacheEntries);

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

  const translate: ReasoningTranslationService["translate"] = Effect.fn(
    "ReasoningTranslation.translate",
  )(function* (request) {
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

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new ReasoningTranslationError({
            status: 500,
            code: "SETTINGS_UNAVAILABLE",
            detail: "Couldn't read text generation model settings.",
            cause,
          }),
      ),
    );
    const modelSelection = settings.textGenerationModelSelection;
    const modelKey = `${modelSelection.instanceId}:${modelSelection.model}`;

    const cacheKey = makeCacheKey(
      request.provider,
      modelKey,
      sourceLanguage,
      targetLanguage,
      request.text,
    );
    const cachedValue = cache.get(cacheKey);
    if (cachedValue !== undefined) {
      return {
        translatedText: cachedValue,
        provider: request.provider,
        cached: true,
        ...(modelKey ? { modelKey } : {}),
      };
    }

    const translatedText = yield* translateWithTextModel(
      request.text,
      sourceLanguage,
      targetLanguage,
      modelSelection,
    ).pipe(
      Effect.timeoutOption(textModelTimeoutMs),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ReasoningTranslationError({
                status: 504,
                code: "TRANSLATION_TIMEOUT",
                detail: `Reasoning translation timed out after ${Math.round(textModelTimeoutMs / 1000)}s.`,
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

    cache.set(cacheKey, translatedText);
    return {
      translatedText,
      provider: request.provider,
      cached: false,
      ...(modelKey ? { modelKey } : {}),
    };
  });

  return ReasoningTranslation.of({ translate });
});

export const layer = Layer.effect(ReasoningTranslation, make());
