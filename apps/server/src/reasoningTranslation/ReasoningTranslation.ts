import type { ModelSelection } from "@prismux/core-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export const REASONING_TRANSLATION_MAX_TEXT_CHARS = 4_000;
export const REASONING_TRANSLATION_MAX_RESPONSE_BYTES = 1_024 * 1_024;
export const REASONING_TRANSLATION_EDGE_AUTH_MAX_BYTES = 64 * 1_024;
export const REASONING_TRANSLATION_CACHE_MAX_ENTRIES = 500;
export const BING_GOOGLE_TIMEOUT_MS = 10_000;
export const TEXT_MODEL_TIMEOUT_MS = 45_000;

export const BING_TRANSLATE_ENDPOINT = "https://edge.microsoft.com/translate/translatetext";
export const BING_EDGE_AUTH_ENDPOINT = "https://edge.microsoft.com/translate/auth";
export const GOOGLE_TRANSLATE_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

export const ReasoningTranslationRequestProvider = Schema.Literals([
  "bing",
  "google",
  "text_model",
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

const isReasoningTranslationError = Schema.is(ReasoningTranslationError);

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
  readonly maxResponseBytes?: number;
  readonly bingGoogleTimeoutMs?: number;
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
  provider: ReasoningTranslationRequestProvider,
  value: string | undefined,
): string {
  const trimmed = value?.trim();
  const lowered = trimmed?.toLowerCase();
  if (provider === "bing") {
    if (!lowered || lowered === "zh" || lowered === "zh-cn" || lowered === "zh-hans" || lowered === "zh-sg") {
      return "zh-Hans";
    }
    if (lowered === "zh-tw" || lowered === "zh-hk" || lowered === "zh-hant") {
      return "zh-Hant";
    }
    return trimmed!;
  }
  if (provider === "google") {
    if (!lowered || lowered === "zh" || lowered === "zh-cn" || lowered === "zh-hans" || lowered === "zh-sg") {
      return "zh-CN";
    }
    if (lowered === "zh-tw" || lowered === "zh-hk" || lowered === "zh-hant") {
      return "zh-TW";
    }
    return trimmed!;
  }
  if (!lowered || lowered === "zh" || lowered === "zh-cn" || lowered === "zh-hans") {
    return "zh-Hans";
  }
  return trimmed!;
}

export function parseBingTranslatePayload(rawJson: string): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!Array.isArray(payload) || payload.length === 0) return null;
  const first = payload[0];
  if (typeof first !== "object" || first === null || !("translations" in first)) return null;
  const translations = (first as { translations?: unknown }).translations;
  if (!Array.isArray(translations) || translations.length === 0) return null;
  const firstTranslation = translations[0];
  if (
    typeof firstTranslation !== "object" ||
    firstTranslation === null ||
    typeof (firstTranslation as { text?: unknown }).text !== "string"
  ) {
    return null;
  }
  return (firstTranslation as { text: string }).text;
}

export function parseGoogleTranslatePayload(rawJson: string): string | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
  const segments = payload[0] as ReadonlyArray<unknown>;
  const parts: Array<string> = [];
  for (const segment of segments) {
    if (Array.isArray(segment) && typeof segment[0] === "string") {
      parts.push(segment[0]);
    }
  }
  if (parts.length === 0) return null;
  return parts.join("");
}

const readBoundedResponseText = Effect.fn("ReasoningTranslation.readBoundedResponseText")(
  function* (
    response: HttpClientResponse.HttpClientResponse,
    maxBytes: number,
    label: string,
  ) {
    const contentLengthHeader = response.headers["content-length"];
    if (contentLengthHeader !== undefined) {
      const declaredBytes = Number(contentLengthHeader);
      if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
        return yield* new ReasoningTranslationError({
          status: 502,
          code: "TRANSLATION_RESPONSE_TOO_LARGE",
          detail: `${label} response exceeded ${maxBytes} bytes.`,
        });
      }
    }
    const chunks: Array<Uint8Array> = [];
    let totalBytes = 0;
    yield* response.stream.pipe(
      Stream.runForEach((chunk) => {
        totalBytes += chunk.byteLength;
        if (totalBytes > maxBytes) {
          return Effect.fail(
            new ReasoningTranslationError({
              status: 502,
              code: "TRANSLATION_RESPONSE_TOO_LARGE",
              detail: `${label} response exceeded ${maxBytes} bytes.`,
            }),
          );
        }
        chunks.push(chunk);
        return Effect.void;
      }),
      Effect.mapError((cause) =>
        isReasoningTranslationError(cause)
          ? cause
          : new ReasoningTranslationError({
              status: 502,
              code: "TRANSLATION_UPSTREAM_FAILED",
              detail: `Failed to read ${label} response body.`,
              cause,
            }),
      ),
    );
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  },
);

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
    const http = yield* HttpClient.HttpClient;
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const textGeneration = yield* TextGeneration.TextGeneration;
    const fileSystem = yield* FileSystem.FileSystem;

    const maxCacheEntries = options.maxCacheEntries ?? REASONING_TRANSLATION_CACHE_MAX_ENTRIES;
    const maxResponseBytes = options.maxResponseBytes ?? REASONING_TRANSLATION_MAX_RESPONSE_BYTES;
    const bingGoogleTimeoutMs = options.bingGoogleTimeoutMs ?? BING_GOOGLE_TIMEOUT_MS;
    const textModelTimeoutMs = options.textModelTimeoutMs ?? TEXT_MODEL_TIMEOUT_MS;

    const cache = new LruCache<string>(maxCacheEntries);
    let cachedEdgeBearerToken: string | null = null;

    const executeRequest = (
      request: HttpClientRequest.HttpClientRequest,
      label: string,
    ): Effect.Effect<HttpClientResponse.HttpClientResponse, ReasoningTranslationError> =>
      http.execute(request).pipe(
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.mapError(
          (cause) =>
            new ReasoningTranslationError({
              status: 502,
              code: "TRANSLATION_UPSTREAM_FAILED",
              detail: `Couldn't reach ${label}.`,
              cause,
            }),
        ),
      );

    const fetchEdgeAnonymousToken = Effect.fn("ReasoningTranslation.fetchEdgeAnonymousToken")(
      function* () {
        const authResponse = yield* executeRequest(
          HttpClientRequest.get(BING_EDGE_AUTH_ENDPOINT).pipe(
            HttpClientRequest.setHeader("accept", "text/plain"),
          ),
          "Bing Translate auth",
        );
        if (authResponse.status < 200 || authResponse.status >= 300) {
          return yield* new ReasoningTranslationError({
            status: 502,
            code: "TRANSLATION_UPSTREAM_FAILED",
            detail: `Bing Translate auth returned HTTP ${authResponse.status}.`,
          });
        }
        const token = (yield* readBoundedResponseText(
          authResponse,
          Math.min(maxResponseBytes, REASONING_TRANSLATION_EDGE_AUTH_MAX_BYTES),
          "Bing Translate auth",
        )).trim();
        if (token.length === 0) {
          return yield* new ReasoningTranslationError({
            status: 502,
            code: "TRANSLATION_UPSTREAM_FAILED",
            detail: "Bing Translate auth returned an empty token.",
          });
        }
        cachedEdgeBearerToken = token;
        return token;
      },
    );

    const translateWithBing = Effect.fn("ReasoningTranslation.translateWithBing")(function* (
      text: string,
      sourceLanguage: string,
      targetLanguage: string,
    ) {
      const params = new URLSearchParams({
        to: targetLanguage,
        isEnterpriseClient: "false",
      });
      if (sourceLanguage !== "auto") {
        params.set("from", sourceLanguage);
      }
      const url = `${BING_TRANSLATE_ENDPOINT}?${params.toString()}`;
      const body = encodeStringArrayJson([text]);

      const sendTranslate = (bearerToken: string | null) => {
        let req = HttpClientRequest.post(url).pipe(
          HttpClientRequest.bodyText(body, "application/json; charset=utf-8"),
        );
        if (bearerToken) {
          req = HttpClientRequest.bearerToken(req, bearerToken);
        }
        return executeRequest(req, "Bing Translate");
      };

      let response = yield* sendTranslate(cachedEdgeBearerToken);
      if (response.status === 401 || response.status === 403) {
        cachedEdgeBearerToken = null;
        const freshToken = yield* fetchEdgeAnonymousToken();
        response = yield* sendTranslate(freshToken);
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* new ReasoningTranslationError({
          status: 502,
          code: "TRANSLATION_UPSTREAM_FAILED",
          detail: `Bing Translate returned HTTP ${response.status}.`,
        });
      }
      const rawBody = yield* readBoundedResponseText(response, maxResponseBytes, "Bing Translate");
      const translatedText = parseBingTranslatePayload(rawBody);
      if (translatedText === null) {
        return yield* new ReasoningTranslationError({
          status: 502,
          code: "TRANSLATION_UPSTREAM_INVALID_RESPONSE",
          detail: "Bing Translate returned an unexpected response payload.",
        });
      }
      return translatedText;
    });

    const translateWithGoogle = Effect.fn("ReasoningTranslation.translateWithGoogle")(function* (
      text: string,
      sourceLanguage: string,
      targetLanguage: string,
    ) {
      const formBody = new URLSearchParams({
        client: "gtx",
        sl: sourceLanguage,
        tl: targetLanguage,
        dt: "t",
        q: text,
      }).toString();

      const response = yield* executeRequest(
        HttpClientRequest.post(GOOGLE_TRANSLATE_ENDPOINT).pipe(
          HttpClientRequest.bodyText(formBody, "application/x-www-form-urlencoded; charset=utf-8"),
        ),
        "Google Translate",
      );
      if (response.status < 200 || response.status >= 300) {
        return yield* new ReasoningTranslationError({
          status: 502,
          code: "TRANSLATION_UPSTREAM_FAILED",
          detail: `Google Translate returned HTTP ${response.status}.`,
        });
      }
      const rawBody = yield* readBoundedResponseText(
        response,
        maxResponseBytes,
        "Google Translate",
      );
      const translatedText = parseGoogleTranslatePayload(rawBody);
      if (translatedText === null) {
        return yield* new ReasoningTranslationError({
          status: 502,
          code: "TRANSLATION_UPSTREAM_INVALID_RESPONSE",
          detail: "Google Translate returned an unexpected response payload.",
        });
      }
      return translatedText;
    });

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

      let modelSelection: ModelSelection | undefined;
      let modelKey = "";
      if (request.provider === "text_model") {
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
        modelSelection = settings.textGenerationModelSelection;
        modelKey = `${modelSelection.instanceId}:${modelSelection.model}`;
      }

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

      const timeoutMs =
        request.provider === "text_model" ? textModelTimeoutMs : bingGoogleTimeoutMs;
      const runProvider =
        request.provider === "bing"
          ? translateWithBing(request.text, sourceLanguage, targetLanguage)
          : request.provider === "google"
            ? translateWithGoogle(request.text, sourceLanguage, targetLanguage)
            : translateWithTextModel(request.text, sourceLanguage, targetLanguage, modelSelection!);

      const translatedText = yield* runProvider.pipe(
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

      cache.set(cacheKey, translatedText);
      return {
        translatedText,
        provider: request.provider,
        cached: false,
        ...(modelKey ? { modelKey } : {}),
      };
    });

    return ReasoningTranslation.of({ translate });
  },
);

export const layer = Layer.effect(ReasoningTranslation, make());
