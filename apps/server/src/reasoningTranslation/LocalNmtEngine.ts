// @effect-diagnostics nodeBuiltinImport:off extendsNativeError:off globalTimers:off globalDate:off - Standalone local WASM NMT module wrapped by ReasoningTranslation Effect service.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeVM from "node:vm";

import {
  DEFAULT_REASONING_TRANSLATION_LOCAL_MODEL_MIRROR,
  type ReasoningTranslationLocalModelMirror,
} from "@prismux/core-contracts";

import { translateWithTechnicalTokenProtection } from "./technicalTokens.ts";

export const LOCAL_NMT_MODEL_ID = "mozilla-bergamot-enzh-v2.2";
export const LOCAL_NMT_MODEL_VERSION = "2.2.0";
export const LOCAL_NMT_DEFAULT_IDLE_UNLOAD_MS = 5 * 60 * 1000;

const VERIFIED_MANIFEST_FILENAME = "manifest.verified.json";
const MOZILLA_CDN_BASE = "https://firefox-settings-attachments.cdn.mozilla.net/";
const FIREFOX_BERGAMOT_COMMIT = "48d55cf7ec80093903e2ef7f58b61a84a22ef716";
const BERGAMOT_JS_REPO_PATH =
  "toolkit/components/translations/bergamot-translator/bergamot-translator.js";

export interface LocalNmtManifestFile {
  readonly filename: string;
  readonly role: "loader" | "wasm" | "model" | "srcvocab" | "trgvocab" | "lex";
  readonly size: number;
  readonly sha256: string;
  readonly urlsByMirror: Readonly<
    Record<ReasoningTranslationLocalModelMirror, ReadonlyArray<string>>
  >;
}

const BERGAMOT_JS_GITHUB_URL = `https://raw.githubusercontent.com/mozilla-firefox/firefox/${FIREFOX_BERGAMOT_COMMIT}/${BERGAMOT_JS_REPO_PATH}`;
const BERGAMOT_JS_JSDELIVR_URL = `https://cdn.jsdelivr.net/gh/mozilla-firefox/firefox@${FIREFOX_BERGAMOT_COMMIT}/${BERGAMOT_JS_REPO_PATH}`;

const mozillaCdnUrls = (
  location: string,
): Readonly<Record<ReasoningTranslationLocalModelMirror, ReadonlyArray<string>>> => {
  const url = `${MOZILLA_CDN_BASE}${location}`;
  return {
    huggingface: [url],
    hf_mirror: [url],
  };
};

/**
 * Pinned Mozilla Bergamot WASM v3.0 + Firefox Translations en->zh-Hans v2.2 model pack.
 * License: MPL-2.0 (Mozilla Public License 2.0). Downloaded strictly on-demand by user action.
 */
export const DEFAULT_LOCAL_NMT_MANIFEST: ReadonlyArray<LocalNmtManifestFile> = [
  {
    filename: "bergamot-translator.js",
    role: "loader",
    size: 100_187,
    sha256: "faff1ef6285b0d26f01787776fd49299dfb756ecb9688aa990c250e66797b47d",
    urlsByMirror: {
      huggingface: [BERGAMOT_JS_GITHUB_URL, BERGAMOT_JS_JSDELIVR_URL],
      hf_mirror: [BERGAMOT_JS_JSDELIVR_URL, BERGAMOT_JS_GITHUB_URL],
    },
  },
  {
    filename: "bergamot-translator.wasm",
    role: "wasm",
    size: 4_960_506,
    sha256: "a3a89d9ad0a4ed8f27bf3e403701b23f5709816f6376438503f2fa5b0182c2dc",
    urlsByMirror: mozillaCdnUrls(
      "main-workspace/translations-wasm/05082c31-aee8-4249-9e01-c1865afd7520.wasm",
    ),
  },
  {
    filename: "model.enzh.intgemm.alphas.bin",
    role: "model",
    size: 43_849_787,
    sha256: "4e5accc141373565ddc8fa1565bceaa8d0c3482a82cab8131c719ebcc6c2157c",
    urlsByMirror: mozillaCdnUrls(
      "main-workspace/translations-models/a7ff7d5e-e67e-406c-a34b-a7edea35b10e.bin",
    ),
  },
  {
    filename: "srcvocab.enzh.spm",
    role: "srcvocab",
    size: 806_952,
    sha256: "bd9b65504acc6d9726dd281f7defc2adb7c2c22d0688fe2f84697de25197c8c5",
    urlsByMirror: mozillaCdnUrls(
      "main-workspace/translations-models/ea98c52c-58dc-45d5-af23-38f2b029d020.spm",
    ),
  },
  {
    filename: "trgvocab.enzh.spm",
    role: "trgvocab",
    size: 772_004,
    sha256: "aded6993c36e440284d11cec3f6b8aef9c0e43188a772d80be342a713adf223d",
    urlsByMirror: mozillaCdnUrls(
      "main-workspace/translations-models/bddbda68-d4d2-4317-a0a1-119caa47525e.spm",
    ),
  },
  {
    filename: "lex.50.50.enzh.s2t.bin",
    role: "lex",
    size: 6_506_248,
    sha256: "4a5e5827788060f1d718a8132b69440929387514a045796e9b77f935db68c055",
    urlsByMirror: mozillaCdnUrls(
      "main-workspace/translations-models/da8fccc0-31df-4665-9703-96d36606e019.bin",
    ),
  },
];

export interface LocalNmtModelStatus {
  readonly installed: boolean;
  readonly downloading: boolean;
  readonly progressPercent: number;
  readonly downloadedBytes: number;
  readonly totalBytes: number;
  readonly modelId: string;
  readonly modelDir: string;
  readonly mirror: ReasoningTranslationLocalModelMirror;
  readonly version: string;
  readonly error: string | null;
  readonly sizeBytes: number;
}

export class LocalNmtError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    code: string,
    status: number,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options);
    this.name = "LocalNmtError";
    this.code = code;
    this.status = status;
  }
}

export interface LocalNmtRuntimeInstance {
  readonly translateLines: (lines: ReadonlyArray<string>) => Promise<ReadonlyArray<string>>;
  readonly dispose: () => void;
}

export type LocalNmtRuntimeFactory = (
  modelDir: string,
  manifest: ReadonlyArray<LocalNmtManifestFile>,
) => Promise<LocalNmtRuntimeInstance>;

export interface LocalNmtEngineOptions {
  readonly stateDir: string;
  readonly modelId?: string;
  readonly version?: string;
  readonly defaultMirror?: ReasoningTranslationLocalModelMirror;
  readonly manifest?: ReadonlyArray<LocalNmtManifestFile>;
  readonly idleUnloadMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly runtimeFactory?: LocalNmtRuntimeFactory;
  readonly downloadTimeoutMs?: number;
}

interface VerifiedManifestRecord {
  readonly modelId: string;
  readonly version: string;
  readonly mirror: ReasoningTranslationLocalModelMirror;
  readonly installedAt: string;
  readonly files: Readonly<Record<string, { readonly size: number; readonly sha256: string }>>;
}

interface BergamotAlignedMemory {
  getByteArrayView: () => Uint8Array;
  delete: () => void;
}

interface BergamotAlignedMemoryList {
  push_back: (mem: BergamotAlignedMemory) => void;
  delete: () => void;
}

interface BergamotVectorString {
  push_back: (value: string) => void;
  delete: () => void;
}

interface BergamotVectorResponseOptions {
  push_back: (options: {
    readonly qualityScores: boolean;
    readonly alignment: boolean;
    readonly html: boolean;
  }) => void;
  delete: () => void;
}

interface BergamotVectorResponse {
  size: () => number;
  get: (index: number) => { getTranslatedText: () => string };
  delete: () => void;
}

interface BergamotTranslationModel {
  delete: () => void;
}

interface BergamotBlockingService {
  translate: (
    model: BergamotTranslationModel,
    messages: BergamotVectorString,
    options: BergamotVectorResponseOptions,
  ) => BergamotVectorResponse;
  delete: () => void;
}

interface BergamotModule {
  AlignedMemory: new (size: number, alignment: number) => BergamotAlignedMemory;
  AlignedMemoryList: new () => BergamotAlignedMemoryList;
  TranslationModel: new (
    srcLang: string,
    trgLang: string,
    config: string,
    modelMem: BergamotAlignedMemory,
    lexMem: BergamotAlignedMemory | null,
    vocabs: BergamotAlignedMemoryList,
    qualityModel: null,
  ) => BergamotTranslationModel;
  BlockingService: new (options: { readonly cacheSize: number }) => BergamotBlockingService;
  VectorString: new () => BergamotVectorString;
  VectorResponseOptions: new () => BergamotVectorResponseOptions;
}

function assertHttpsDownloadUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new LocalNmtError(
      "LOCAL_NMT_INVALID_URL",
      400,
      `Invalid local NMT download URL: ${rawUrl}`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new LocalNmtError(
      "LOCAL_NMT_INSECURE_URL",
      400,
      `Local NMT model downloads require HTTPS; rejected protocol "${parsed.protocol}".`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new LocalNmtError(
      "LOCAL_NMT_INVALID_URL",
      400,
      "Local NMT download URLs must not contain embedded credentials.",
    );
  }
  return parsed;
}

function isChineseTargetLanguage(targetLanguage: string): boolean {
  const lowered = targetLanguage.trim().toLowerCase();
  return (
    lowered === "" ||
    lowered === "auto" ||
    lowered === "zh" ||
    lowered === "zh-cn" ||
    lowered === "zh-hans"
  );
}

async function renameDirectoryWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await NodeFS.promises.rename(source, destination);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (attempt < 3 && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

async function createBergamotRuntime(
  modelDir: string,
  manifest: ReadonlyArray<LocalNmtManifestFile>,
): Promise<LocalNmtRuntimeInstance> {
  const byRole = new Map<LocalNmtManifestFile["role"], string>();
  for (const entry of manifest) {
    byRole.set(entry.role, NodePath.join(modelDir, entry.filename));
  }
  const loaderPath = byRole.get("loader");
  const wasmPath = byRole.get("wasm");
  const modelPath = byRole.get("model");
  const srcVocabPath = byRole.get("srcvocab");
  const trgVocabPath = byRole.get("trgvocab");
  const lexPath = byRole.get("lex");

  if (!loaderPath || !wasmPath || !modelPath || !srcVocabPath || !trgVocabPath) {
    throw new LocalNmtError(
      "LOCAL_NMT_CORRUPT_MANIFEST",
      500,
      "Local NMT model manifest is incomplete.",
    );
  }

  const [loaderCode, wasmBuf, modelBuf, srcVocabBuf, trgVocabBuf, lexBuf] = await Promise.all([
    NodeFS.promises.readFile(loaderPath, "utf8"),
    NodeFS.promises.readFile(wasmPath),
    NodeFS.promises.readFile(modelPath),
    NodeFS.promises.readFile(srcVocabPath),
    NodeFS.promises.readFile(trgVocabPath),
    lexPath ? NodeFS.promises.readFile(lexPath) : Promise.resolve(null),
  ]);

  // Execute Mozilla's Emscripten loader inside a locked-down VM context with zero Node/network access.
  const sandbox: Record<string, unknown> = {
    WebAssembly: (globalThis as { readonly WebAssembly?: unknown }).WebAssembly,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    ArrayBuffer,
    DataView,
    URL,
    performance,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    TypeError,
    RangeError,
    Map,
    Set,
    WeakMap,
    Symbol,
    Reflect,
    Proxy,
    crypto: globalThis.crypto,
    process: undefined,
    require: undefined,
    fetch: undefined,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  const vmContext = NodeVM.createContext(sandbox);
  NodeVM.runInContext(loaderCode, vmContext, { filename: "bergamot-translator.js" });

  const loadBergamot = sandbox.loadBergamot as
    | ((moduleArg: Record<string, unknown>) => BergamotModule)
    | undefined;
  if (typeof loadBergamot !== "function") {
    throw new LocalNmtError(
      "LOCAL_NMT_RUNTIME_INIT_FAILED",
      500,
      "Local NMT WASM loader did not expose loadBergamot().",
    );
  }

  const wasmArrayBuffer = wasmBuf.buffer.slice(
    wasmBuf.byteOffset,
    wasmBuf.byteOffset + wasmBuf.byteLength,
  );
  const bergamot = await new Promise<BergamotModule>((resolve, reject) => {
    let settled = false;
    try {
      const mod = loadBergamot({
        INITIAL_MEMORY: 41_943_040,
        wasmBinary: wasmArrayBuffer,
        print: () => {},
        printErr: () => {},
        onAbort: (reason: unknown) => {
          if (settled) return;
          settled = true;
          reject(
            new LocalNmtError(
              "LOCAL_NMT_RUNTIME_ABORTED",
              500,
              `Local NMT WASM aborted during initialization: ${String(reason)}`,
            ),
          );
        },
        onRuntimeInitialized: () => {
          queueMicrotask(() => {
            if (settled) return;
            settled = true;
            resolve(mod);
          });
        },
      });
    } catch (error) {
      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });

  const alloc = (buf: Buffer, alignment: number): BergamotAlignedMemory => {
    const mem = new bergamot.AlignedMemory(buf.byteLength, alignment);
    mem.getByteArrayView().set(buf);
    return mem;
  };

  const modelMem = alloc(modelBuf, 256);
  const lexMem = lexBuf ? alloc(lexBuf, 64) : null;
  const srcVocabMem = alloc(srcVocabBuf, 64);
  const trgVocabMem = alloc(trgVocabBuf, 64);
  const vocabList = new bergamot.AlignedMemoryList();
  vocabList.push_back(srcVocabMem);
  vocabList.push_back(trgVocabMem);

  const config = [
    "beam-size: 1",
    "normalize: 1.0",
    "word-penalty: 0",
    "max-length-break: 128",
    "mini-batch-words: 512",
    "workspace: 48",
    "max-length-factor: 2.0",
    "skip-cost: true",
    "cpu-threads: 0",
    "quiet: true",
    "quiet-translation: true",
    "gemm-precision: int8shiftAlphaAll",
    "alignment: soft",
  ].join("\n");

  const model = new bergamot.TranslationModel(
    "en",
    "zh-Hans",
    config,
    modelMem,
    lexMem,
    vocabList,
    null,
  );
  const service = new bergamot.BlockingService({ cacheSize: 0 });
  let disposed = false;

  const translateLines = async (lines: ReadonlyArray<string>): Promise<ReadonlyArray<string>> => {
    if (disposed) {
      throw new LocalNmtError("LOCAL_NMT_DISPOSED", 500, "Local NMT runtime was unloaded.");
    }
    const results: string[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const messages = new bergamot.VectorString();
      const options = new bergamot.VectorResponseOptions();
      let response: BergamotVectorResponse | undefined;
      try {
        messages.push_back(line);
        options.push_back({ qualityScores: false, alignment: false, html: false });
        response = service.translate(model, messages, options);
        const translated = response.size() > 0 ? response.get(0).getTranslatedText() : line;
        results.push(translated);
      } finally {
        response?.delete();
        options.delete();
        messages.delete();
      }
      // Yield between lines so concurrent HTTP/WS events never stall on long reasoning traces.
      if (index + 1 < lines.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    return results;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    try {
      service.delete();
    } catch {
      // ignore teardown errors
    }
    try {
      model.delete();
    } catch {
      // ignore teardown errors
    }
    try {
      vocabList.delete();
    } catch {
      // ignore teardown errors
    }
    try {
      modelMem.delete();
    } catch {
      // ignore teardown errors
    }
    try {
      lexMem?.delete();
    } catch {
      // ignore teardown errors
    }
    try {
      srcVocabMem.delete();
    } catch {
      // ignore teardown errors
    }
    try {
      trgVocabMem.delete();
    } catch {
      // ignore teardown errors
    }
  };

  return { translateLines, dispose };
}

export class LocalNmtEngine {
  readonly modelId: string;
  readonly version: string;
  readonly modelDir: string;
  private readonly parentDir: string;
  private readonly manifest: ReadonlyArray<LocalNmtManifestFile>;
  private readonly totalBytes: number;
  private readonly idleUnloadMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly runtimeFactory: LocalNmtRuntimeFactory;
  private readonly downloadTimeoutMs: number;

  private mirror: ReasoningTranslationLocalModelMirror;
  private downloading = false;
  private downloadedBytes = 0;
  private progressPercent = 0;
  private error: string | null = null;
  private activeAbortController: AbortController | null = null;
  private activeDownloadPromise: Promise<LocalNmtModelStatus> | null = null;
  private activeStagingDir: string | null = null;

  private runtime: LocalNmtRuntimeInstance | null = null;
  private runtimeLoadPromise: Promise<LocalNmtRuntimeInstance> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private inferenceTail: Promise<unknown> = Promise.resolve();

  constructor(options: LocalNmtEngineOptions) {
    this.modelId = options.modelId ?? LOCAL_NMT_MODEL_ID;
    this.version = options.version ?? LOCAL_NMT_MODEL_VERSION;
    this.parentDir = NodePath.join(options.stateDir, "models", "reasoning-translate");
    this.modelDir = NodePath.join(this.parentDir, this.modelId);
    this.manifest = options.manifest ?? DEFAULT_LOCAL_NMT_MANIFEST;
    this.totalBytes = this.manifest.reduce((sum, entry) => sum + entry.size, 0);
    this.idleUnloadMs = options.idleUnloadMs ?? LOCAL_NMT_DEFAULT_IDLE_UNLOAD_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.runtimeFactory = options.runtimeFactory ?? createBergamotRuntime;
    this.downloadTimeoutMs = options.downloadTimeoutMs ?? 5 * 60 * 1000;
    this.mirror = options.defaultMirror ?? DEFAULT_REASONING_TRANSLATION_LOCAL_MODEL_MIRROR;
  }

  /** Pure local filesystem check; NEVER triggers any network traffic. */
  getStatus(mirrorOverride?: ReasoningTranslationLocalModelMirror): LocalNmtModelStatus {
    const installedCheck = this.inspectInstalledOnDisk();
    const effectiveMirror = installedCheck.mirror ?? mirrorOverride ?? this.mirror;
    return {
      installed: installedCheck.installed,
      downloading: this.downloading,
      progressPercent: installedCheck.installed ? 100 : this.downloading ? this.progressPercent : 0,
      downloadedBytes: installedCheck.installed
        ? installedCheck.sizeBytes
        : this.downloading
          ? this.downloadedBytes
          : 0,
      totalBytes: this.totalBytes,
      modelId: this.modelId,
      modelDir: this.modelDir,
      mirror: effectiveMirror,
      version: this.version,
      error: this.error,
      sizeBytes: installedCheck.sizeBytes,
    };
  }

  /** Starts an explicit background download and returns live status immediately for UI polling. */
  startDownload(options?: {
    readonly mirror?: ReasoningTranslationLocalModelMirror;
  }): LocalNmtModelStatus {
    const mirror = options?.mirror ?? this.mirror;
    this.mirror = mirror;
    if (this.inspectInstalledOnDisk().installed) {
      this.error = null;
      return this.getStatus(mirror);
    }
    if (!this.downloading) {
      void this.downloadModel({ mirror }).catch(() => {
        // Error state is captured in `this.error` and exposed through `getStatus()`.
      });
    }
    return this.getStatus(mirror);
  }

  /** Downloads and verifies all pinned model files atomically. Fail-closed on any SHA-256 mismatch. */
  async downloadModel(options?: {
    readonly mirror?: ReasoningTranslationLocalModelMirror;
    readonly signal?: AbortSignal;
  }): Promise<LocalNmtModelStatus> {
    const mirror = options?.mirror ?? this.mirror;
    this.mirror = mirror;

    if (this.inspectInstalledOnDisk().installed) {
      this.error = null;
      return this.getStatus(mirror);
    }

    if (this.activeDownloadPromise) {
      return this.activeDownloadPromise;
    }

    const controller = new AbortController();
    this.activeAbortController = controller;
    const onExternalAbort = (): void => {
      controller.abort(options?.signal?.reason ?? new Error("Download cancelled."));
    };
    if (options?.signal) {
      if (options.signal.aborted) {
        onExternalAbort();
      } else {
        options.signal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    this.downloading = true;
    this.downloadedBytes = 0;
    this.progressPercent = 0;
    this.error = null;

    const stagingDir = NodePath.join(
      this.parentDir,
      `.${this.modelId}.staging-${NodeCrypto.randomUUID()}`,
    );
    this.activeStagingDir = stagingDir;

    let task: Promise<LocalNmtModelStatus> | null = null;
    task = (async (): Promise<LocalNmtModelStatus> => {
      try {
        await NodeFS.promises.mkdir(stagingDir, { recursive: true });
        let completedBytes = 0;
        const verifiedFiles: Record<string, { readonly size: number; readonly sha256: string }> =
          {};

        for (const file of this.manifest) {
          this.throwIfAborted(controller.signal);
          const urls = file.urlsByMirror[mirror];
          if (!urls || urls.length === 0) {
            throw new LocalNmtError(
              "LOCAL_NMT_NO_MIRROR_URL",
              500,
              `No download URL configured for ${file.filename} on mirror "${mirror}".`,
            );
          }

          const destPath = NodePath.join(stagingDir, file.filename);
          const result = await this.downloadAndVerifyFile({
            file,
            urls,
            destPath,
            baseDownloadedBytes: completedBytes,
            signal: controller.signal,
          });
          completedBytes += result.bytes;
          this.downloadedBytes = completedBytes;
          this.progressPercent =
            this.totalBytes > 0
              ? Math.min(99, Math.floor((completedBytes / this.totalBytes) * 100))
              : 99;
          verifiedFiles[file.filename] = {
            size: result.bytes,
            sha256: result.sha256,
          };
        }

        this.throwIfAborted(controller.signal);

        const verifiedRecord: VerifiedManifestRecord = {
          modelId: this.modelId,
          version: this.version,
          mirror,
          installedAt: new Date().toISOString(),
          files: verifiedFiles,
        };
        await NodeFS.promises.writeFile(
          NodePath.join(stagingDir, VERIFIED_MANIFEST_FILENAME),
          JSON.stringify(verifiedRecord, null, 2),
          "utf8",
        );

        this.unloadRuntime();
        await NodeFS.promises.rm(this.modelDir, { recursive: true, force: true });
        await renameDirectoryWithRetry(stagingDir, this.modelDir);
        this.activeStagingDir = null;

        this.downloading = false;
        this.downloadedBytes = this.totalBytes;
        this.progressPercent = 100;
        this.error = null;
        return this.getStatus(mirror);
      } catch (err) {
        await NodeFS.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        this.activeStagingDir = null;
        this.downloading = false;
        this.downloadedBytes = 0;
        this.progressPercent = 0;
        if (this.isAbortError(err, controller.signal)) {
          this.error = null;
          throw new LocalNmtError(
            "LOCAL_NMT_DOWNLOAD_CANCELLED",
            499,
            "Local NMT model download was cancelled.",
          );
        }
        const normalized =
          err instanceof LocalNmtError
            ? err
            : new LocalNmtError(
                "LOCAL_NMT_DOWNLOAD_FAILED",
                502,
                err instanceof Error ? err.message : "Failed to download local NMT model.",
                { cause: err },
              );
        this.error = normalized.message;
        throw normalized;
      } finally {
        options?.signal?.removeEventListener("abort", onExternalAbort);
        if (this.activeAbortController === controller) {
          this.activeAbortController = null;
        }
        if (this.activeDownloadPromise === task) {
          this.activeDownloadPromise = null;
        }
      }
    })();

    this.activeDownloadPromise = task;
    return task;
  }

  /** Cancels any active model download and cleans up staging files. */
  async cancelDownload(): Promise<LocalNmtModelStatus> {
    const controller = this.activeAbortController;
    const inflight = this.activeDownloadPromise;
    if (controller) {
      controller.abort(new Error("Download cancelled by user."));
    }
    if (inflight) {
      await inflight.catch(() => {});
    }
    if (this.activeStagingDir) {
      await NodeFS.promises
        .rm(this.activeStagingDir, { recursive: true, force: true })
        .catch(() => {});
      this.activeStagingDir = null;
    }
    this.downloading = false;
    this.downloadedBytes = 0;
    this.progressPercent = 0;
    this.error = null;
    return this.getStatus();
  }

  /** Unloads WASM memory and deletes the installed local NMT model pack from disk. */
  async removeModel(): Promise<LocalNmtModelStatus> {
    await this.cancelDownload();
    this.unloadRuntime();
    await NodeFS.promises.rm(this.modelDir, { recursive: true, force: true });
    // Clean any leftover staging directories for this model.
    if (NodeFS.existsSync(this.parentDir)) {
      const entries = await NodeFS.promises.readdir(this.parentDir).catch(() => []);
      for (const name of entries) {
        if (name.startsWith(`.${this.modelId}.staging-`)) {
          await NodeFS.promises
            .rm(NodePath.join(this.parentDir, name), { recursive: true, force: true })
            .catch(() => {});
        }
      }
    }
    this.error = null;
    return this.getStatus();
  }

  /** Translates English reasoning text to Simplified Chinese 100% offline. */
  async translate(
    text: string,
    _sourceLanguage = "auto",
    targetLanguage = "zh-Hans",
  ): Promise<string> {
    if (!isChineseTargetLanguage(targetLanguage)) {
      throw new LocalNmtError(
        "LOCAL_NMT_UNSUPPORTED_LANGUAGE",
        400,
        `Local offline NMT supports Simplified Chinese (zh-Hans) output; requested "${targetLanguage}".`,
      );
    }
    if (!this.inspectInstalledOnDisk().installed) {
      throw new LocalNmtError(
        "LOCAL_NMT_NOT_INSTALLED",
        412,
        "Local offline NMT model is not installed yet. Download it in Settings → Reasoning Translation.",
      );
    }

    const run = async (): Promise<string> => {
      const runtime = await this.ensureRuntimeLoaded();
      this.touchIdleTimer();
      try {
        return await translateWithTechnicalTokenProtection(text, (lines) =>
          runtime.translateLines(lines),
        );
      } finally {
        this.touchIdleTimer();
      }
    };

    const next = this.inferenceTail.then(run, run);
    this.inferenceTail = next.catch(() => {});
    return next;
  }

  /** Releases loaded WASM runtime memory immediately (also invoked automatically on idle timeout). */
  unloadRuntime(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const existing = this.runtime;
    this.runtime = null;
    this.runtimeLoadPromise = null;
    if (existing) {
      existing.dispose();
    }
  }

  /** Exposed for unit tests to verify idle unloading behavior. */
  isRuntimeLoaded(): boolean {
    return this.runtime !== null;
  }

  dispose(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort(new Error("Engine disposed."));
      this.activeAbortController = null;
    }
    this.unloadRuntime();
  }

  private touchIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.idleUnloadMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.unloadRuntime();
    }, this.idleUnloadMs);
    this.idleTimer.unref();
  }

  private async ensureRuntimeLoaded(): Promise<LocalNmtRuntimeInstance> {
    if (this.runtime) {
      return this.runtime;
    }
    if (this.runtimeLoadPromise) {
      return this.runtimeLoadPromise;
    }
    const promise = this.runtimeFactory(this.modelDir, this.manifest)
      .then((instance) => {
        this.runtime = instance;
        this.runtimeLoadPromise = null;
        this.touchIdleTimer();
        return instance;
      })
      .catch((error) => {
        this.runtimeLoadPromise = null;
        if (error instanceof LocalNmtError) throw error;
        throw new LocalNmtError(
          "LOCAL_NMT_RUNTIME_INIT_FAILED",
          500,
          error instanceof Error ? error.message : "Failed to initialize local NMT runtime.",
          { cause: error },
        );
      });
    this.runtimeLoadPromise = promise;
    return promise;
  }

  private inspectInstalledOnDisk(): {
    readonly installed: boolean;
    readonly sizeBytes: number;
    readonly mirror: ReasoningTranslationLocalModelMirror | undefined;
  } {
    const markerPath = NodePath.join(this.modelDir, VERIFIED_MANIFEST_FILENAME);
    if (!NodeFS.existsSync(markerPath)) {
      return { installed: false, sizeBytes: 0, mirror: undefined };
    }
    let record: VerifiedManifestRecord;
    try {
      record = JSON.parse(NodeFS.readFileSync(markerPath, "utf8")) as VerifiedManifestRecord;
    } catch {
      return { installed: false, sizeBytes: 0, mirror: undefined };
    }
    if (record.modelId !== this.modelId || record.version !== this.version || !record.files) {
      return { installed: false, sizeBytes: 0, mirror: undefined };
    }
    let totalOnDisk = 0;
    for (const entry of this.manifest) {
      const recorded = record.files[entry.filename];
      if (!recorded || recorded.sha256 !== entry.sha256 || recorded.size !== entry.size) {
        return { installed: false, sizeBytes: 0, mirror: undefined };
      }
      const filePath = NodePath.join(this.modelDir, entry.filename);
      try {
        const stat = NodeFS.statSync(filePath);
        if (!stat.isFile() || stat.size !== entry.size) {
          return { installed: false, sizeBytes: 0, mirror: undefined };
        }
        totalOnDisk += stat.size;
      } catch {
        return { installed: false, sizeBytes: 0, mirror: undefined };
      }
    }
    const mirror =
      record.mirror === "huggingface" || record.mirror === "hf_mirror" ? record.mirror : undefined;
    return { installed: true, sizeBytes: totalOnDisk, mirror };
  }

  private async downloadAndVerifyFile(input: {
    readonly file: LocalNmtManifestFile;
    readonly urls: ReadonlyArray<string>;
    readonly destPath: string;
    readonly baseDownloadedBytes: number;
    readonly signal: AbortSignal;
  }): Promise<{ readonly bytes: number; readonly sha256: string }> {
    let lastError: unknown;
    for (let index = 0; index < input.urls.length; index += 1) {
      const url = assertHttpsDownloadUrl(input.urls[index]!).toString();
      this.throwIfAborted(input.signal);
      try {
        return await this.fetchVerifySingleUrl({
          file: input.file,
          url,
          destPath: input.destPath,
          baseDownloadedBytes: input.baseDownloadedBytes,
          signal: input.signal,
        });
      } catch (err) {
        // Never silently retry past checksum mismatch or user cancellation.
        if (
          this.isAbortError(err, input.signal) ||
          (err instanceof LocalNmtError && err.code === "LOCAL_NMT_CHECKSUM_MISMATCH")
        ) {
          throw err;
        }
        lastError = err;
        await NodeFS.promises.rm(input.destPath, { force: true }).catch(() => {});
      }
    }
    throw lastError instanceof LocalNmtError
      ? lastError
      : new LocalNmtError(
          "LOCAL_NMT_DOWNLOAD_FAILED",
          502,
          `Failed to download ${input.file.filename}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
          { cause: lastError },
        );
  }

  private async fetchVerifySingleUrl(input: {
    readonly file: LocalNmtManifestFile;
    readonly url: string;
    readonly destPath: string;
    readonly baseDownloadedBytes: number;
    readonly signal: AbortSignal;
  }): Promise<{ readonly bytes: number; readonly sha256: string }> {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(new Error(`Download timed out for ${input.file.filename}`));
    }, this.downloadTimeoutMs);
    timeoutId.unref();

    const onParentAbort = (): void => {
      timeoutController.abort(input.signal.reason ?? new Error("Cancelled"));
    };
    input.signal.addEventListener("abort", onParentAbort, { once: true });

    let fileHandle: NodeFS.promises.FileHandle | null = null;
    try {
      const response = await this.fetchImpl(input.url, {
        method: "GET",
        signal: timeoutController.signal,
        headers: {
          "user-agent": "Prismux-LocalNMT/1.0",
        },
      });
      if (!response.ok) {
        throw new LocalNmtError(
          "LOCAL_NMT_DOWNLOAD_HTTP_ERROR",
          502,
          `Download failed for ${input.file.filename} with HTTP ${response.status}.`,
        );
      }

      const hash = NodeCrypto.createHash("sha256");
      let fileBytes = 0;
      fileHandle = await NodeFS.promises.open(input.destPath, "w", 0o600);

      if (response.body && typeof response.body.getReader === "function") {
        const reader = response.body.getReader();
        while (true) {
          this.throwIfAborted(input.signal);
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          fileBytes += value.byteLength;
          if (fileBytes > input.file.size) {
            throw new LocalNmtError(
              "LOCAL_NMT_CHECKSUM_MISMATCH",
              502,
              `Downloaded file ${input.file.filename} exceeded expected size of ${input.file.size} bytes.`,
            );
          }
          hash.update(value);
          await fileHandle.write(value);
          this.downloadedBytes = input.baseDownloadedBytes + fileBytes;
          if (this.totalBytes > 0) {
            this.progressPercent = Math.min(
              99,
              Math.floor((this.downloadedBytes / this.totalBytes) * 100),
            );
          }
        }
      } else {
        const ab = await response.arrayBuffer();
        const bytes = new Uint8Array(ab);
        this.throwIfAborted(input.signal);
        fileBytes = bytes.byteLength;
        if (fileBytes > input.file.size) {
          throw new LocalNmtError(
            "LOCAL_NMT_CHECKSUM_MISMATCH",
            502,
            `Downloaded file ${input.file.filename} exceeded expected size of ${input.file.size} bytes.`,
          );
        }
        hash.update(bytes);
        await fileHandle.write(bytes);
        this.downloadedBytes = input.baseDownloadedBytes + fileBytes;
        if (this.totalBytes > 0) {
          this.progressPercent = Math.min(
            99,
            Math.floor((this.downloadedBytes / this.totalBytes) * 100),
          );
        }
      }

      await fileHandle.close();
      fileHandle = null;

      const actualSha256 = hash.digest("hex");
      if (fileBytes !== input.file.size || actualSha256 !== input.file.sha256) {
        await NodeFS.promises.rm(input.destPath, { force: true }).catch(() => {});
        throw new LocalNmtError(
          "LOCAL_NMT_CHECKSUM_MISMATCH",
          502,
          `SHA-256 verification failed for ${input.file.filename} (expected ${input.file.sha256}, got ${actualSha256}).`,
        );
      }

      return { bytes: fileBytes, sha256: actualSha256 };
    } finally {
      clearTimeout(timeoutId);
      input.signal.removeEventListener("abort", onParentAbort);
      if (fileHandle) {
        await fileHandle.close().catch(() => {});
      }
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new LocalNmtError(
        "LOCAL_NMT_DOWNLOAD_CANCELLED",
        499,
        "Local NMT model download was cancelled.",
      );
    }
  }

  private isAbortError(err: unknown, signal: AbortSignal): boolean {
    if (signal.aborted) return true;
    if (err instanceof LocalNmtError && err.code === "LOCAL_NMT_DOWNLOAD_CANCELLED") return true;
    return err instanceof Error && err.name === "AbortError";
  }
}
