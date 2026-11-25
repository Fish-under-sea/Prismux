import { useAtomValue } from "@effect/atom-react";
import type { ReasoningTranslationProvider } from "@prismux/core-contracts/settings";
import { useEffect, useState, useSyncExternalStore } from "react";

import { resolvePrimaryEnvironmentHttpUrl } from "../environments/primary";
import { readDesktopPrimaryBearerToken } from "../environments/primary/desktopAuth";
import { useClientSettings } from "../hooks/useSettings";
import { primaryServerSettingsAtom } from "../state/server";

export {
  ReasoningTranslationBody,
  type ReasoningTranslationBodyProps,
} from "./ReasoningTranslationBody";

export const REASONING_TRANSLATION_MAX_TEXT_CHARS = 4_000;
export const DEFAULT_REASONING_TRANSLATION_TARGET_LANGUAGE = "zh-Hans";
export const DEFAULT_REASONING_TRANSLATION_SOURCE_LANGUAGE = "auto";
export const REASONING_TRANSLATION_ENDPOINT = "/api/reasoning/translate";

export type ActiveReasoningTranslationProvider = Exclude<ReasoningTranslationProvider, "off">;

export interface ReasoningTranslationRequestInput {
  readonly provider: ActiveReasoningTranslationProvider;
  readonly text: string;
  readonly targetLanguage?: string | undefined;
  readonly sourceLanguage?: string | undefined;
}

export interface ReasoningTranslationResponse {
  readonly translatedText: string;
  readonly provider: ActiveReasoningTranslationProvider;
  readonly cached: boolean;
  readonly modelKey?: string | undefined;
}

export interface ReasoningTranslationRequestOptions {
  readonly signal?: AbortSignal | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly baseUrl?: string | undefined;
  readonly readBearerToken?: (() => Promise<string | null>) | undefined;
}

export type ReasoningTranslateFn = (
  input: ReasoningTranslationRequestInput,
  options?: { readonly signal?: AbortSignal | undefined },
) => Promise<ReasoningTranslationResponse>;

// @effect-diagnostics-next-line extendsNativeError:off -- Standard HTTP client error outside Effect runtime.
export class ReasoningTranslationRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, options: { readonly status: number; readonly code: string }) {
    super(message);
    this.name = "ReasoningTranslationRequestError";
    this.status = options.status;
    this.code = options.code;
  }
}

const PARAGRAPH_BOUNDARY_RE = /\r?\n(?:[\t ]*\r?\n)+/g;
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
 * Detects whether reasoning prose is already written in Chinese after stripping code blocks,
 * inline code, URLs, file paths, and code identifiers.
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

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function clampUtf16SafeEnd(text: string, start: number, proposedEnd: number): number {
  let end = Math.min(proposedEnd, text.length);
  if (end > start && end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) {
    end -= 1;
  }
  return end > start ? end : Math.min(start + 1, text.length);
}

function splitOversizedParagraph(paragraph: string, maxTextChars: number): Array<string> {
  const limit = Math.max(2, Math.floor(maxTextChars));
  if (paragraph.length <= limit) return [paragraph];

  const chunks: Array<string> = [];
  let cursor = 0;
  const total = paragraph.length;

  while (cursor < total) {
    if (total - cursor <= limit) {
      const rest = paragraph.slice(cursor).trim();
      if (rest.length > 0) chunks.push(rest);
      break;
    }

    const hardEnd = clampUtf16SafeEnd(paragraph, cursor, cursor + limit);
    const windowSlice = paragraph.slice(cursor, hardEnd);

    // Prefer splitting cleanly on a newline or whitespace boundary when available.
    const minPreferred = Math.floor(windowSlice.length * 0.4);
    let breakOffset = windowSlice.lastIndexOf("\n");
    if (breakOffset < minPreferred) {
      breakOffset = -1;
      for (let i = windowSlice.length - 1; i >= minPreferred; i -= 1) {
        if (/\s/.test(windowSlice[i] ?? "")) {
          breakOffset = i;
          break;
        }
      }
    }

    const nextEnd =
      breakOffset > 0 ? clampUtf16SafeEnd(paragraph, cursor, cursor + breakOffset) : hardEnd;
    const piece = paragraph.slice(cursor, nextEnd).trim();
    if (piece.length > 0) {
      chunks.push(piece);
    }

    cursor = nextEnd;
    while (cursor < total && /\s/.test(paragraph[cursor] ?? "")) {
      cursor += 1;
    }
  }

  return chunks;
}

/**
 * Splits reasoning text into paragraph fragments matching DSH `reasoningFragments`:
 * - Splits on blank-line paragraph boundaries (`/\r?\n(?:[\t ]*\r?\n)+/g`)
 * - Chunks any single paragraph exceeding `maxTextChars` (default 4000) at
 *   whitespace and UTF-16 surrogate-pair safe boundaries.
 */
export function reasoningFragments(
  text: string,
  options?: { readonly maxTextChars?: number | undefined },
): ReadonlyArray<string> {
  if (text.trim().length === 0) return [];
  const maxTextChars = options?.maxTextChars ?? REASONING_TRANSLATION_MAX_TEXT_CHARS;
  const paragraphs = text.split(PARAGRAPH_BOUNDARY_RE);
  const result: Array<string> = [];
  for (const rawParagraph of paragraphs) {
    const trimmed = rawParagraph.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length <= maxTextChars) {
      result.push(trimmed);
    } else {
      result.push(...splitOversizedParagraph(trimmed, maxTextChars));
    }
  }
  return result;
}

export function makeReasoningTranslationCacheKey(input: {
  readonly provider: ActiveReasoningTranslationProvider;
  readonly modelKey: string;
  readonly targetLanguage: string;
  readonly fragmentText: string;
}): string {
  return JSON.stringify([
    input.provider,
    input.provider === "text_model" ? input.modelKey : "",
    input.targetLanguage,
    input.fragmentText,
  ]);
}

export class ReasoningTranslationMemoryCache {
  private readonly entries = new Map<string, string>();
  private readonly maxEntries: number;

  constructor(maxEntries = 1_000) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): string | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: string): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(key, value);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const sharedReasoningTranslationCache = new ReasoningTranslationMemoryCache(1_000);

function isSameOriginBrowserEndpoint(url: string): boolean {
  if (
    typeof window === "undefined" ||
    window.desktopBridge !== undefined ||
    !window.location?.origin?.startsWith("http")
  ) {
    return false;
  }
  try {
    return new URL(url, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function resolveReasoningTranslateUrl(baseUrl?: string): string {
  if (baseUrl !== undefined) {
    const trimmed = baseUrl.replace(/\/+$/, "");
    return `${trimmed}${REASONING_TRANSLATION_ENDPOINT}`;
  }
  try {
    return resolvePrimaryEnvironmentHttpUrl(REASONING_TRANSLATION_ENDPOINT);
  } catch {
    return REASONING_TRANSLATION_ENDPOINT;
  }
}

export async function requestReasoningTranslation(
  input: ReasoningTranslationRequestInput,
  options: ReasoningTranslationRequestOptions = {},
): Promise<ReasoningTranslationResponse> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const url = resolveReasoningTranslateUrl(options.baseUrl);
  const sameOrigin = isSameOriginBrowserEndpoint(url);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };

  if (!sameOrigin) {
    const readBearer = options.readBearerToken ?? readDesktopPrimaryBearerToken;
    const token = await readBearer().catch(() => null);
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    credentials: sameOrigin ? "include" : "omit",
    ...(options.signal ? { signal: options.signal } : {}),
    body: JSON.stringify({
      provider: input.provider,
      text: input.text,
      ...(input.targetLanguage ? { targetLanguage: input.targetLanguage } : {}),
      ...(input.sourceLanguage ? { sourceLanguage: input.sourceLanguage } : {}),
    }),
  });

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const record =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { error?: unknown; code?: unknown })
        : {};
    const detail =
      typeof record.error === "string" && record.error.trim().length > 0
        ? record.error
        : `Translation request failed with HTTP ${response.status}.`;
    const code =
      typeof record.code === "string" && record.code.trim().length > 0
        ? record.code
        : `HTTP_${response.status}`;
    throw new ReasoningTranslationRequestError(detail, { status: response.status, code });
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { translatedText?: unknown }).translatedText !== "string"
  ) {
    throw new ReasoningTranslationRequestError("Invalid reasoning translation response payload.", {
      status: 502,
      code: "INVALID_RESPONSE",
    });
  }

  const payload = parsed as {
    translatedText: string;
    provider?: ActiveReasoningTranslationProvider;
    cached?: boolean;
    modelKey?: string;
  };
  return {
    translatedText: payload.translatedText,
    provider: payload.provider ?? input.provider,
    cached: payload.cached === true,
    ...(typeof payload.modelKey === "string" ? { modelKey: payload.modelKey } : {}),
  };
}

export type ReasoningTranslationStatus = "idle" | "translating" | "ready" | "partial" | "error";

export interface ReasoningTranslationFragmentState {
  readonly index: number;
  readonly source: string;
  readonly translated: string | null;
  readonly pending: boolean;
  readonly deferred: boolean;
  readonly error: string | null;
  readonly errorCode: string | null;
}

export interface ReasoningTranslationSnapshot {
  readonly enabled: boolean;
  readonly provider: ReasoningTranslationProvider;
  readonly status: ReasoningTranslationStatus;
  readonly isTranslating: boolean;
  readonly showOriginal: boolean;
  readonly displayText: string;
  readonly translatedText: string;
  readonly originalText: string;
  readonly fragments: ReadonlyArray<ReasoningTranslationFragmentState>;
  readonly translatedFragmentCount: number;
  readonly totalFragmentCount: number;
  readonly error: string | null;
  readonly errorCode: string | null;
}

export interface ReasoningTranslationControllerInput {
  readonly text: string;
  readonly running: boolean;
  readonly provider: ReasoningTranslationProvider;
  readonly modelKey?: string | undefined;
  readonly targetLanguage?: string | undefined;
  readonly sourceLanguage?: string | undefined;
}

export interface ReasoningTranslationControllerOptions {
  readonly cache?: ReasoningTranslationMemoryCache | undefined;
  readonly translate?: ReasoningTranslateFn | undefined;
  readonly maxTextChars?: number | undefined;
}

interface ActiveTask {
  readonly key: string;
  readonly controller: AbortController;
}

export class ReasoningTranslationController {
  private readonly cache: ReasoningTranslationMemoryCache;
  private readonly translate: ReasoningTranslateFn;
  private readonly maxTextChars: number;
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Map<string, ActiveTask>();
  private readonly errors = new Map<string, { readonly message: string; readonly code: string }>();

  private input: ReasoningTranslationControllerInput = {
    text: "",
    running: false,
    provider: "off",
    modelKey: "",
    targetLanguage: DEFAULT_REASONING_TRANSLATION_TARGET_LANGUAGE,
    sourceLanguage: DEFAULT_REASONING_TRANSLATION_SOURCE_LANGUAGE,
  };
  private showOriginal = false;
  private disposed = false;
  private version = 0;
  private snapshot: ReasoningTranslationSnapshot;

  constructor(options: ReasoningTranslationControllerOptions = {}) {
    this.cache = options.cache ?? sharedReasoningTranslationCache;
    this.translate = options.translate ?? ((req, opts) => requestReasoningTranslation(req, opts));
    this.maxTextChars = options.maxTextChars ?? REASONING_TRANSLATION_MAX_TEXT_CHARS;
    this.snapshot = this.computeSnapshotFor(this.input);
  }

  getSnapshot = (): ReasoningTranslationSnapshot => this.snapshot;

  getVersion = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  setShowOriginal = (next: boolean): void => {
    if (this.showOriginal === next) return;
    this.showOriginal = next;
    this.refreshSnapshot();
  };

  toggleShowOriginal = (): void => {
    this.setShowOriginal(!this.showOriginal);
  };

  /** Cancels in-flight translation fetches without permanently disposing the controller. */
  cancelPending = (): void => {
    this.abortAllInFlight();
  };

  update = (next: ReasoningTranslationControllerInput): void => {
    if (this.disposed) return;
    const normalized = this.normalizeInput(next);

    const providerOrModelChanged =
      normalized.provider !== this.input.provider ||
      normalized.modelKey !== this.input.modelKey ||
      normalized.targetLanguage !== this.input.targetLanguage ||
      normalized.sourceLanguage !== this.input.sourceLanguage;

    const sameInput =
      !providerOrModelChanged &&
      normalized.text === this.input.text &&
      normalized.running === this.input.running;

    if (sameInput) return;

    this.input = normalized;

    if (providerOrModelChanged) {
      this.errors.clear();
      this.abortAllInFlight();
    }

    if (
      normalized.provider === "off" ||
      shouldSkipReasoningTranslation(normalized.text, normalized.targetLanguage)
    ) {
      this.abortAllInFlight();
      this.refreshSnapshot();
      return;
    }

    this.scheduleTranslations();
    this.refreshSnapshot();
  };

  retry = (): void => {
    if (this.disposed) return;
    if (
      this.input.provider === "off" ||
      shouldSkipReasoningTranslation(this.input.text, this.input.targetLanguage)
    ) {
      return;
    }
    this.errors.clear();
    this.scheduleTranslations();
    this.refreshSnapshot();
  };

  dispose = (): void => {
    this.disposed = true;
    this.abortAllInFlight();
    this.listeners.clear();
  };

  private normalizeInput(
    input: ReasoningTranslationControllerInput,
  ): ReasoningTranslationControllerInput {
    return {
      text: input.text,
      running: input.running,
      provider: input.provider,
      modelKey: input.modelKey ?? "",
      targetLanguage: input.targetLanguage ?? DEFAULT_REASONING_TRANSLATION_TARGET_LANGUAGE,
      sourceLanguage: input.sourceLanguage ?? DEFAULT_REASONING_TRANSLATION_SOURCE_LANGUAGE,
    };
  }

  private abortAllInFlight(): void {
    for (const task of this.inFlight.values()) {
      task.controller.abort();
    }
    this.inFlight.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private refreshSnapshot(): void {
    this.version += 1;
    this.snapshot = this.computeSnapshotFor(this.input);
    this.emit();
  }

  private getActiveKeysFor(input: ReasoningTranslationControllerInput): ReadonlyArray<{
    readonly index: number;
    readonly source: string;
    readonly key: string;
    readonly deferred: boolean;
    readonly skipped: boolean;
  }> {
    const { provider, text, running } = input;
    const targetLanguage = input.targetLanguage ?? DEFAULT_REASONING_TRANSLATION_TARGET_LANGUAGE;
    if (provider === "off" || shouldSkipReasoningTranslation(text, targetLanguage)) return [];
    const fragments = reasoningFragments(text, { maxTextChars: this.maxTextChars });
    const modelKey = input.modelKey ?? "";
    return fragments.map((source, index) => {
      const skipped = shouldSkipReasoningTranslation(source, targetLanguage);
      // While streaming (`running`), defer the still-growing tail fragment until a paragraph
      // boundary arrives or streaming completes.
      const deferred = !skipped && running && index === fragments.length - 1;
      const key = makeReasoningTranslationCacheKey({
        provider,
        modelKey,
        targetLanguage,
        fragmentText: source,
      });
      return { index, source, key, deferred, skipped };
    });
  }

  private scheduleTranslations(): void {
    const provider = this.input.provider;
    if (provider === "off") return;

    const entries = this.getActiveKeysFor(this.input);
    const activeKeySet = new Set(
      entries.filter((entry) => !entry.deferred && !entry.skipped).map((entry) => entry.key),
    );

    // Abort requests for fragments no longer in the current reasoning text.
    for (const [key, task] of this.inFlight.entries()) {
      if (!activeKeySet.has(key)) {
        task.controller.abort();
        this.inFlight.delete(key);
      }
    }

    const maxConcurrency = provider === "text_model" ? 2 : 3;
    for (const entry of entries) {
      if (this.inFlight.size >= maxConcurrency) break;
      if (entry.deferred || entry.skipped) continue;
      if (this.cache.get(entry.key) !== undefined) continue;
      if (this.inFlight.has(entry.key)) continue;
      if (this.errors.has(entry.key)) continue;

      const controller = new AbortController();
      this.inFlight.set(entry.key, { key: entry.key, controller });

      void this.runFragmentTranslation(entry.key, provider, entry.source, controller);
    }
  }

  private async runFragmentTranslation(
    key: string,
    provider: ActiveReasoningTranslationProvider,
    fragmentText: string,
    controller: AbortController,
  ): Promise<void> {
    try {
      const response = await this.translate(
        {
          provider,
          text: fragmentText,
          targetLanguage:
            this.input.targetLanguage ?? DEFAULT_REASONING_TRANSLATION_TARGET_LANGUAGE,
          sourceLanguage:
            this.input.sourceLanguage ?? DEFAULT_REASONING_TRANSLATION_SOURCE_LANGUAGE,
        },
        { signal: controller.signal },
      );
      if (this.disposed || controller.signal.aborted) return;
      this.cache.set(key, response.translatedText);
      this.errors.delete(key);
    } catch (error) {
      if (this.disposed || controller.signal.aborted) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Translation failed.";
      const code =
        error instanceof ReasoningTranslationRequestError ? error.code : "TRANSLATION_FAILED";
      this.errors.set(key, { message, code });
    } finally {
      const current = this.inFlight.get(key);
      if (current?.controller === controller) {
        this.inFlight.delete(key);
      }
      if (!this.disposed) {
        this.scheduleTranslations();
        this.refreshSnapshot();
      }
    }
  }

  /** Pure derivation safe to invoke during React render for frame-0 cache hydration. */
  computeSnapshotFor = (rawInput: ReasoningTranslationControllerInput): ReasoningTranslationSnapshot => {
    const input = this.normalizeInput(rawInput);
    const { provider, text } = input;
    const targetLanguage = input.targetLanguage ?? DEFAULT_REASONING_TRANSLATION_TARGET_LANGUAGE;
    const enabled =
      provider !== "off" && !shouldSkipReasoningTranslation(text, targetLanguage);
    if (!enabled) {
      return {
        enabled: false,
        provider,
        status: "idle",
        isTranslating: false,
        showOriginal: this.showOriginal,
        displayText: text,
        translatedText: "",
        originalText: text,
        fragments: [],
        translatedFragmentCount: 0,
        totalFragmentCount: 0,
        error: null,
        errorCode: null,
      };
    }

    const entries = this.getActiveKeysFor(input);
    let translatedFragmentCount = 0;
    let hasPending = false;

    const fragments: Array<ReasoningTranslationFragmentState> = entries.map((entry) => {
      const translated = entry.skipped ? entry.source : (this.cache.get(entry.key) ?? null);
      const pending =
        !entry.deferred && !entry.skipped && translated === null && this.inFlight.has(entry.key);
      const err =
        !entry.skipped && translated === null ? (this.errors.get(entry.key) ?? null) : null;
      if (translated !== null) translatedFragmentCount += 1;
      if (pending) hasPending = true;
      return {
        index: entry.index,
        source: entry.source,
        translated,
        pending,
        deferred: entry.deferred,
        error: err?.message ?? null,
        errorCode: err?.code ?? null,
      };
    });

    const firstErrorFragment = fragments.find((fragment) => fragment.error !== null) ?? null;
    const totalFragmentCount = fragments.length;
    const allTranslated = totalFragmentCount > 0 && translatedFragmentCount === totalFragmentCount;
    const translatedText =
      translatedFragmentCount > 0
        ? fragments.map((fragment) => fragment.translated ?? fragment.source).join("\n\n")
        : "";

    let status: ReasoningTranslationStatus = "idle";
    if (allTranslated) {
      status = "ready";
    } else if (hasPending) {
      status = translatedFragmentCount > 0 ? "partial" : "translating";
    } else if (firstErrorFragment !== null) {
      status = translatedFragmentCount > 0 ? "partial" : "error";
    } else if (translatedFragmentCount > 0) {
      status = "partial";
    }

    const displayText =
      this.showOriginal || translatedFragmentCount === 0 ? text : translatedText;

    return {
      enabled: true,
      provider,
      status,
      isTranslating: hasPending,
      showOriginal: this.showOriginal,
      displayText,
      translatedText,
      originalText: text,
      fragments,
      translatedFragmentCount,
      totalFragmentCount,
      error: firstErrorFragment?.error ?? null,
      errorCode: firstErrorFragment?.errorCode ?? null,
    };
  };
}

export interface UseReasoningTranslationOptions {
  readonly text: string;
  readonly running?: boolean | undefined;
  readonly provider?: ReasoningTranslationProvider | undefined;
  readonly modelKey?: string | undefined;
  readonly targetLanguage?: string | undefined;
  readonly sourceLanguage?: string | undefined;
  readonly enabled?: boolean | undefined;
  readonly cache?: ReasoningTranslationMemoryCache | undefined;
  readonly translate?: ReasoningTranslateFn | undefined;
}

export interface UseReasoningTranslationResult extends ReasoningTranslationSnapshot {
  readonly toggleShowOriginal: () => void;
  readonly setShowOriginal: (value: boolean) => void;
  readonly retry: () => void;
}

export function useReasoningTranslation(
  options: UseReasoningTranslationOptions,
): UseReasoningTranslationResult {
  const configuredProvider = useClientSettings((settings) => settings.reasoningTranslationProvider);
  const serverSettings = useAtomValue(primaryServerSettingsAtom);
  const effectiveProvider: ReasoningTranslationProvider =
    options.enabled === false ? "off" : (options.provider ?? configuredProvider);
  const effectiveModelKey =
    options.modelKey ??
    (effectiveProvider === "text_model"
      ? `${serverSettings.textGenerationModelSelection.instanceId}:${serverSettings.textGenerationModelSelection.model}`
      : "");

  const [controller] = useState(
    () =>
      new ReasoningTranslationController({
        cache: options.cache,
        translate: options.translate,
      }),
  );

  // Subscribe to async controller state transitions (cache fills, toggles, errors).
  useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);

  const isRunning = options.running === true;
  const text = options.text;
  const targetLanguage = options.targetLanguage;
  const sourceLanguage = options.sourceLanguage;

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- Syncs external async translation requests & AbortControllers with live reasoning text and aborts pending fetches on unmount.
  useEffect(() => {
    controller.update({
      text,
      running: isRunning,
      provider: effectiveProvider,
      modelKey: effectiveModelKey,
      targetLanguage,
      sourceLanguage,
    });
    return () => {
      controller.cancelPending();
    };
  }, [
    controller,
    text,
    isRunning,
    effectiveProvider,
    effectiveModelKey,
    targetLanguage,
    sourceLanguage,
  ]);

  const snapshot = controller.computeSnapshotFor({
    text,
    running: isRunning,
    provider: effectiveProvider,
    modelKey: effectiveModelKey,
    targetLanguage,
    sourceLanguage,
  });

  return {
    ...snapshot,
    toggleShowOriginal: controller.toggleShowOriginal,
    setShowOriginal: controller.setShowOriginal,
    retry: controller.retry,
  };
}
