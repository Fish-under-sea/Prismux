import {
  NonNegativeInt,
  requireSettingsSecretLiteral,
  SettingsSecretUnresolvedError,
  SourceControlProviderKind,
  type PullRequestMergeMethod,
  type ServerSettings,
  type SourceControlProviderAuth,
  type SourceControlProviderInfo,
  type SourceControlRepositoryCloneUrls,
  type SourceControlRepositoryVisibility,
} from "@prismux/core-contracts";
import { sanitizeBranchFragment } from "@prismux/core-shared/git";
import { isSshRemoteUrl } from "@prismux/core-shared/sourceControl";
import { collectUint8StreamText } from "@prismux/provider-core/server/collectStreamText";
import * as SourceControlHost from "@prismux/source-control-core/server/SourceControlHost";
import * as SourceControlProvider from "@prismux/source-control-core/server/SourceControlProvider";
import * as SourceControlRateLimit from "@prismux/source-control-core/server/SourceControlRateLimit";
import {
  readSourceControlHostSettings,
  recognizeRemoteWith,
} from "@prismux/source-control-core/shared/definition";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as GiteeDefinition from "../shared/definition.ts";
import {
  GiteePullRequestCommentListSchema,
  GiteePullRequestCommentSchema,
  GiteePullRequestCommitListSchema,
  GiteePullRequestFileListSchema,
  GiteePullRequestListSchema,
  GiteePullRequestSchema,
  GiteeRepositorySchema,
  GiteeUserSchema,
  normalizeGiteePullRequestRecord,
  type GiteeRawComment,
  type GiteeRawPullRequest,
  type GiteeRawPullRequestCommit,
  type GiteeRawPullRequestFile,
  type GiteeRepository,
  type GiteeUser,
  type NormalizedGiteePullRequestRecord,
} from "./giteePullRequests.ts";

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const GITEE_API_REQUEST_TIMEOUT = "30 seconds";
const CONCURRENCY = 4;
const HEADER_SAFE = /^[\x21-\x7e]+$/u;

export const GITEE_INSTALL_HINT =
  "Add a Gitee personal access token in Settings → Version Control & Issues, or set GITEE_TOKEN.";
export const GITEE_UNAUTHENTICATED_DETAIL = `Available. ${GITEE_INSTALL_HINT}`;

const GiteeApiEnvConfig = Config.all({
  prismuxApiBaseUrl: Config.String("PRISMUX_GITEE_API_BASE_URL").pipe(Config.option),
  apiBaseUrl: Config.String("GITEE_API_BASE_URL").pipe(Config.option),
  token: Config.String("GITEE_TOKEN").pipe(Config.option),
  prismuxToken: Config.String("PRISMUX_GITEE_TOKEN").pipe(Config.option),
});

export const GiteeServesHost = Config.all({
  prismuxApiBaseUrl: Config.String("PRISMUX_GITEE_API_BASE_URL").pipe(Config.option),
  apiBaseUrl: Config.String("GITEE_API_BASE_URL").pipe(Config.option),
}).pipe(
  Config.map((env) => {
    const customUrl = Option.getOrUndefined(
      Option.orElse(env.prismuxApiBaseUrl, () => env.apiBaseUrl),
    );
    const customHost = customUrl ? (URL.parse(customUrl)?.hostname.toLowerCase() ?? null) : null;
    return (host: string) => {
      const normalized = host.trim().toLowerCase();
      return (
        GiteeDefinition.isGiteeHost(normalized) ||
        (customHost !== null && normalized === customHost)
      );
    };
  }),
);

const GiteeApiOperation = Schema.Literals([
  "resolveRepository",
  "getRepository",
  "getPullRequest",
  "listPullRequests",
  "createRepository",
  "createPullRequest",
  "mergePullRequest",
  "updatePullRequest",
  "listPullRequestFiles",
  "listPullRequestComments",
  "createPullRequestComment",
  "updatePullRequestComment",
  "listPullRequestCommits",
  "isRepositoryStarred",
  "starRepository",
  "getViewer",
  "probeAuth",
  "checkoutPullRequest",
]);
type GiteeApiOperation = typeof GiteeApiOperation.Type;

export class GiteeRepositoryLocatorError extends Schema.TaggedError<GiteeRepositoryLocatorError>()(
  "GiteeRepositoryLocatorError",
  {
    repository: Schema.String,
  },
) {
  static readonly detail = "Gitee repositories must be specified as owner/repo.";

  get detail(): string {
    return GiteeRepositoryLocatorError.detail;
  }

  get userFacingDetail(): string {
    return GiteeRepositoryLocatorError.detail;
  }

  override get message(): string {
    return `Gitee API failed: ${this.detail}`;
  }
}

export class GiteeRequestError extends Schema.TaggedError<GiteeRequestError>()(
  "GiteeRequestError",
  {
    operation: GiteeApiOperation,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return "Failed to send the Gitee request.";
  }

  override get message(): string {
    return `Gitee API failed in ${this.operation}: ${this.detail}`;
  }
}

export class GiteeResponseError extends Schema.TaggedError<GiteeResponseError>()(
  "GiteeResponseError",
  {
    operation: GiteeApiOperation,
    status: Schema.Int,
    responseBodyLength: NonNegativeInt,
    retryAt: Schema.optional(Schema.Number),
  },
) {
  get detail(): string {
    return `Gitee returned HTTP ${this.status}.`;
  }

  override get message(): string {
    return `Gitee API failed in ${this.operation}: ${this.detail}`;
  }
}

export class GiteeResponseBodyReadError extends Schema.TaggedError<GiteeResponseBodyReadError>()(
  "GiteeResponseBodyReadError",
  {
    operation: GiteeApiOperation,
    status: Schema.Int,
    retryAt: Schema.optional(Schema.Number),
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Gitee returned HTTP ${this.status}.`;
  }

  override get message(): string {
    return `Gitee API failed in ${this.operation}: ${this.detail}`;
  }
}

export class GiteeResponseDecodeError extends Schema.TaggedError<GiteeResponseDecodeError>()(
  "GiteeResponseDecodeError",
  {
    operation: GiteeApiOperation,
    status: Schema.Int,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return "Gitee returned invalid JSON for the requested resource.";
  }

  override get message(): string {
    return `Gitee API failed in ${this.operation}: ${this.detail}`;
  }
}

export class GiteeRepositoryVcsResolveError extends Schema.TaggedError<GiteeRepositoryVcsResolveError>()(
  "GiteeRepositoryVcsResolveError",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Failed to resolve VCS repository for ${this.cwd}.`;
  }

  override get message(): string {
    return `Gitee API failed in resolveRepository: ${this.detail}`;
  }
}

export class GiteeRepositoryRemotesListError extends Schema.TaggedError<GiteeRepositoryRemotesListError>()(
  "GiteeRepositoryRemotesListError",
  {
    cwd: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Failed to list remotes for ${this.cwd}.`;
  }

  override get message(): string {
    return `Gitee API failed in resolveRepository: ${this.detail}`;
  }
}

export class GiteeRepositoryRemoteNotFoundError extends Schema.TaggedError<GiteeRepositoryRemoteNotFoundError>()(
  "GiteeRepositoryRemoteNotFoundError",
  {
    cwd: Schema.String,
  },
) {
  get detail(): string {
    return `No Gitee repository remote was detected for ${this.cwd}.`;
  }

  override get message(): string {
    return `Gitee API failed in resolveRepository: ${this.detail}`;
  }
}

export class GiteePullRequestBodyReadError extends Schema.TaggedError<GiteePullRequestBodyReadError>()(
  "GiteePullRequestBodyReadError",
  {
    cwd: Schema.String,
    bodyFile: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Failed to read pull request body file ${this.bodyFile}.`;
  }

  override get message(): string {
    return `Gitee API failed in createPullRequest: ${this.detail}`;
  }
}

export class GiteeCheckoutError extends Schema.TaggedError<GiteeCheckoutError>()(
  "GiteeCheckoutError",
  {
    cwd: Schema.String,
    reference: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return "Failed to check out the Gitee pull request.";
  }

  override get message(): string {
    return `Gitee API failed in checkoutPullRequest: ${this.detail}`;
  }
}

export class GiteeViewerUnavailableError extends Schema.TaggedError<GiteeViewerUnavailableError>()(
  "GiteeViewerUnavailableError",
  {},
) {
  get detail(): string {
    return "Gitee returned no account login for the configured token.";
  }

  override get message(): string {
    return `Gitee API failed in getViewer: ${this.detail}`;
  }
}

export const GiteeApiError = Schema.Union([
  GiteeRepositoryLocatorError,
  GiteeRequestError,
  GiteeResponseError,
  GiteeResponseBodyReadError,
  GiteeResponseDecodeError,
  GiteeRepositoryVcsResolveError,
  GiteeRepositoryRemotesListError,
  GiteeRepositoryRemoteNotFoundError,
  GiteePullRequestBodyReadError,
  GiteeCheckoutError,
  GiteeViewerUnavailableError,
  SourceControlRateLimit.SourceControlRateLimitPausedError,
  SettingsSecretUnresolvedError,
]);
export type GiteeApiError = typeof GiteeApiError.Type;
const isGiteeApiError = Schema.is(GiteeApiError);

export interface GiteeRepositoryLocator {
  readonly owner: string;
  readonly repo: string;
}

export class GiteeApi extends Context.Service<
  GiteeApi,
  {
    readonly probeAuth: Effect.Effect<SourceControlProviderAuth, never>;
    readonly getViewer: () => Effect.Effect<GiteeUser, GiteeApiError>;
    readonly getRepository: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly repository?: string;
    }) => Effect.Effect<GiteeRepository, GiteeApiError>;
    readonly getRepositoryCloneUrls: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly repository: string;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, GiteeApiError>;
    readonly createRepository: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly visibility: SourceControlRepositoryVisibility;
    }) => Effect.Effect<SourceControlRepositoryCloneUrls, GiteeApiError>;
    readonly getDefaultBranch: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
    }) => Effect.Effect<string | null, GiteeApiError>;
    readonly listPullRequests: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly headSelector: string;
      readonly source?: SourceControlProvider.SourceControlRefSelector;
      readonly state: "open" | "closed" | "merged" | "all";
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<NormalizedGiteePullRequestRecord>, GiteeApiError>;
    readonly listRepositoryPullRequests: (input: {
      readonly repository: string;
      readonly state: "open" | "closed" | "merged" | "all";
      readonly page?: number;
      readonly perPage?: number;
      readonly head?: string;
    }) => Effect.Effect<ReadonlyArray<GiteeRawPullRequest>, GiteeApiError>;
    readonly getPullRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly reference: string;
    }) => Effect.Effect<NormalizedGiteePullRequestRecord, GiteeApiError>;
    readonly getRawPullRequestByNumber: (input: {
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<GiteeRawPullRequest, GiteeApiError>;
    readonly createPullRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly baseBranch: string;
      readonly headSelector: string;
      readonly source?: SourceControlProvider.SourceControlRefSelector;
      readonly target?: SourceControlProvider.SourceControlRefSelector;
      readonly title: string;
      readonly bodyFile: string;
      readonly draft?: boolean;
    }) => Effect.Effect<GiteeRawPullRequest, GiteeApiError>;
    readonly mergePullRequest: (input: {
      readonly repository: string;
      readonly number: number;
      readonly mergeMethod?: PullRequestMergeMethod;
    }) => Effect.Effect<void, GiteeApiError>;
    readonly updatePullRequest: (input: {
      readonly repository: string;
      readonly number: number;
      readonly title?: string | undefined;
      readonly body?: string | undefined;
      readonly state?: "open" | "closed" | undefined;
    }) => Effect.Effect<GiteeRawPullRequest, GiteeApiError>;
    readonly listPullRequestFiles: (input: {
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<ReadonlyArray<GiteeRawPullRequestFile>, GiteeApiError>;
    readonly listPullRequestComments: (input: {
      readonly repository: string;
      readonly number: number;
      readonly page?: number;
      readonly perPage?: number;
    }) => Effect.Effect<ReadonlyArray<GiteeRawComment>, GiteeApiError>;
    readonly createPullRequestComment: (input: {
      readonly repository: string;
      readonly number: number;
      readonly body: string;
      readonly commitId?: string | undefined;
      readonly path?: string | undefined;
      readonly position?: number | undefined;
      readonly inReplyToId?: number | undefined;
    }) => Effect.Effect<GiteeRawComment, GiteeApiError>;
    readonly updatePullRequestComment: (input: {
      readonly repository: string;
      readonly commentId: string;
      readonly body: string;
    }) => Effect.Effect<GiteeRawComment, GiteeApiError>;
    readonly listPullRequestCommits: (input: {
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<ReadonlyArray<GiteeRawPullRequestCommit>, GiteeApiError>;
    readonly checkoutPullRequest: (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly reference: string;
      readonly force?: boolean;
    }) => Effect.Effect<void, GiteeApiError>;
    readonly isRepositoryStarred: (repository: string) => Effect.Effect<boolean>;
    readonly starRepository: (repository: string) => Effect.Effect<boolean>;
  }
>()("@prismux/source-control-gitee/server/GiteeApi") {}

function nonEmpty(value: string | null | undefined): Option.Option<string> {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? Option.none() : Option.some(trimmed);
}

function normalizeChangeRequestId(reference: string): string {
  const trimmed = reference.trim().replace(/^#/, "");
  const urlMatch = /\/pulls\/(\d+)(?:\D.*)?$/i.exec(trimmed);
  return urlMatch?.[1] ?? trimmed;
}

export function parseGiteeRepositorySlug(value: string): GiteeRepositoryLocator | null {
  const normalized = value.trim().replace(/\.git$/u, "");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo || owner === "." || owner === ".." || repo === "." || repo === "..") {
    return null;
  }
  return { owner, repo };
}

function requireRepositoryLocator(
  repository: string,
): Effect.Effect<GiteeRepositoryLocator, GiteeApiError> {
  const locator = parseGiteeRepositorySlug(repository);
  return locator
    ? Effect.succeed(locator)
    : Effect.fail(new GiteeRepositoryLocatorError({ repository }));
}

function parseGiteeRemoteUrl(remoteUrl: string): GiteeRepositoryLocator | null {
  const trimmed = remoteUrl.trim();
  const scpMatch = /^[a-zA-Z0-9._-]+@[^:/]+:(.+)$/.exec(trimmed);
  if (scpMatch?.[1]) {
    return parseGiteeRepositorySlug(scpMatch[1]);
  }
  try {
    return parseGiteeRepositorySlug(new URL(trimmed).pathname);
  } catch {
    return null;
  }
}

function normalizeApiBaseUrl(raw: string | undefined): string {
  const trimmed = raw?.trim().replace(/\/+$/u, "") ?? "";
  if (trimmed.length === 0) return GiteeDefinition.GITEE_DEFAULT_API_BASE_URL;
  const parsed = URL.parse(trimmed);
  if (!parsed || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    return GiteeDefinition.GITEE_DEFAULT_API_BASE_URL;
  }
  return trimmed;
}

function hostFromBaseUrl(baseUrl: string): string {
  return URL.parse(baseUrl)?.hostname.toLowerCase() ?? GiteeDefinition.GITEE_PUBLIC_HOST;
}

function webOriginFromApiBaseUrl(baseUrl: string): string {
  return URL.parse(baseUrl)?.origin ?? `https://${GiteeDefinition.GITEE_PUBLIC_HOST}`;
}

function normalizeRepositoryCloneUrls(
  raw: GiteeRepository,
  apiBaseUrl: string,
): SourceControlRepositoryCloneUrls {
  const host = hostFromBaseUrl(apiBaseUrl);
  const origin = webOriginFromApiBaseUrl(apiBaseUrl);
  const rawHtml = raw.html_url?.trim() ?? "";
  const httpsUrl =
    rawHtml.length > 0
      ? rawHtml.endsWith(".git")
        ? rawHtml
        : `${rawHtml.replace(/\/+$/u, "")}.git`
      : `${origin}/${raw.full_name}.git`;
  const sshUrl = raw.ssh_url?.trim() || `git@${host}:${raw.full_name}.git`;

  return {
    nameWithOwner: raw.full_name,
    url: httpsUrl,
    sshUrl,
  };
}

function giteeMergeMethod(
  method: PullRequestMergeMethod | undefined,
): "merge" | "squash" | "rebase" {
  switch (method) {
    case "squash":
      return "squash";
    case "rebase":
    case "fast-forward":
      return "rebase";
    default:
      return "merge";
  }
}

function selectCloneUrl(input: {
  readonly cloneUrls: SourceControlRepositoryCloneUrls;
  readonly originRemoteUrl: string | null;
}): string {
  return input.originRemoteUrl && isSshRemoteUrl(input.originRemoteUrl)
    ? input.cloneUrls.sshUrl
    : input.cloneUrls.url;
}

function checkoutBranchName(input: {
  readonly pullRequestNumber: number;
  readonly headBranch: string;
  readonly isCrossRepository: boolean;
}): string {
  if (!input.isCrossRepository) return input.headBranch;
  return `prismux/pr-${input.pullRequestNumber}/${sanitizeBranchFragment(input.headBranch)}`;
}

function repositoryOwnerName(repositoryName: string): string {
  return repositoryName.split("/")[0]?.trim() || "gitee";
}

function sourceOwnerFromInput(input: {
  readonly headSelector: string;
  readonly source?: SourceControlProvider.SourceControlRefSelector;
}): string | undefined {
  if (input.source?.owner) return input.source.owner;
  return SourceControlProvider.parseSourceControlOwnerRef(input.headSelector)?.owner;
}

const resolveRuntimeConfig = Effect.fn("GiteeApi.resolveRuntimeConfig")(function* (
  settings: GiteeDefinition.GiteeSettings,
  secretProviders: ServerSettings["secretProviders"],
  env: Config.Success<typeof GiteeApiEnvConfig>,
) {
  const literalToken = yield* requireSettingsSecretLiteral(settings.accessToken, secretProviders);
  const envToken = Option.getOrElse(
    Option.orElse(env.token, () => env.prismuxToken),
    () => "",
  ).trim();
  const rawToken = literalToken.trim() || envToken;
  const token = HEADER_SAFE.test(rawToken) ? rawToken : null;

  const envBaseUrl = Option.getOrUndefined(
    Option.orElse(env.prismuxApiBaseUrl, () => env.apiBaseUrl),
  );
  const apiBaseUrl = normalizeApiBaseUrl(settings.apiBaseUrl.trim() || envBaseUrl);
  return { token, apiBaseUrl, host: hostFromBaseUrl(apiBaseUrl) };
});

const responseError = Effect.fn("GiteeApi.responseError")(function* (
  operation: GiteeApiOperation,
  response: HttpClientResponse.HttpClientResponse,
): Effect.fn.Return<never, GiteeApiError> {
  const now = yield* Clock.currentTimeMillis;
  const retryAt = SourceControlRateLimit.retryAtFromHeader(response.headers["retry-after"], now);
  const collected = yield* collectUint8StreamText({
    stream: response.stream,
    maxBytes: DEFAULT_MAX_RESPONSE_BYTES,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new GiteeResponseBodyReadError({
          operation,
          status: response.status,
          retryAt,
          cause,
        }),
    ),
  );
  return yield* new GiteeResponseError({
    operation,
    status: response.status,
    responseBodyLength: collected.text.length,
    retryAt,
  });
});

/** @public */
export const make = Effect.gen(function* () {
  const env = yield* GiteeApiEnvConfig;
  const host = yield* SourceControlHost.SourceControlHost;
  const git = host.git;
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const limits = yield* SourceControlRateLimit.SourceControlRateLimit;
  const slots = yield* Semaphore.make(CONCURRENCY);

  const currentConfig = host.settings.getWithSecrets(GiteeDefinition.definition.kind).pipe(
    Effect.map((settings) => ({
      gitee: readSourceControlHostSettings(
        GiteeDefinition.settings,
        settings.sourceControlHosts[GiteeDefinition.definition.kind],
      ),
      secretProviders: settings.secretProviders,
    })),
    Effect.catch((error) =>
      Effect.logWarning("failed to read Gitee credentials from settings", {
        operation: error.operation,
      }).pipe(
        Effect.as({
          gitee: readSourceControlHostSettings(GiteeDefinition.settings, {}),
          secretProviders: {},
        }),
      ),
    ),
    Effect.flatMap(({ gitee, secretProviders }) =>
      resolveRuntimeConfig(gitee, secretProviders, env),
    ),
  );

  const servesProvider = (provider: SourceControlProviderInfo | null, configuredHost: string) => {
    if (provider?.kind !== "gitee") return false;
    const providerHost = URL.parse(provider.baseUrl)?.hostname.toLowerCase() ?? "";
    return GiteeDefinition.isGiteeHost(providerHost) || providerHost === configuredHost;
  };

  const throttled = Effect.fn("GiteeApi.throttled")(
    function* <A, R>(method: string, apiHost: string, effect: Effect.Effect<A, GiteeApiError, R>) {
      const rateLimitKey = {
        provider: SourceControlProviderKind.make("gitee"),
        host: apiHost,
      };
      const interactive = yield* SourceControlRateLimit.Interactive;
      const lease = yield* limits.check(
        rateLimitKey,
        interactive || method !== "GET" ? { allowPaused: true } : undefined,
      );
      return yield* effect.pipe(
        Effect.tap(() => limits.recordSuccess({ ...rateLimitKey, lease })),
        Effect.tapError((error) =>
          (error._tag === "GiteeResponseError" || error._tag === "GiteeResponseBodyReadError") &&
          error.status === 429
            ? limits.recordRateLimit({ ...rateLimitKey, lease, retryAt: error.retryAt })
            : Effect.void,
        ),
      );
    },
    (effect) => slots.withPermit(effect),
  );

  const executeRaw = Effect.fn("GiteeApi.executeRaw")(function* (
    operation: GiteeApiOperation,
    build: (apiBaseUrl: string) => HttpClientRequest.HttpClientRequest,
  ) {
    const runtime = yield* currentConfig;
    const baseRequest = build(runtime.apiBaseUrl).pipe(HttpClientRequest.acceptJson);
    const authed =
      runtime.token === null
        ? baseRequest
        : baseRequest.pipe(HttpClientRequest.bearerToken(runtime.token));
    return yield* throttled(
      authed.method,
      runtime.host,
      httpClient.execute(authed).pipe(
        Effect.mapError((cause) => new GiteeRequestError({ operation, cause })),
        Effect.timeout(GITEE_API_REQUEST_TIMEOUT),
        Effect.catchTags({
          TimeoutError: (cause) => Effect.fail(new GiteeRequestError({ operation, cause })),
        }),
      ),
    );
  });

  const decodeResponse = <S extends Schema.Top>(
    operation: GiteeApiOperation,
    schema: S,
    response: HttpClientResponse.HttpClientResponse,
  ): Effect.Effect<S["Type"], GiteeApiError, S["DecodingServices"]> =>
    HttpClientResponse.matchStatus({
      "2xx": (success) =>
        HttpClientResponse.schemaBodyJson(schema)(success).pipe(
          Effect.mapError(
            (cause) =>
              new GiteeResponseDecodeError({
                operation,
                status: success.status,
                cause,
              }),
          ),
        ),
      orElse: (failed) => responseError(operation, failed),
    })(response);

  const executeJson = <S extends Schema.Top>(
    operation: GiteeApiOperation,
    build: (apiBaseUrl: string) => HttpClientRequest.HttpClientRequest,
    schema: S,
  ): Effect.Effect<S["Type"], GiteeApiError, S["DecodingServices"]> =>
    executeRaw(operation, build).pipe(
      Effect.flatMap((response) => decodeResponse(operation, schema, response)),
    );

  const executeEmpty = (
    operation: GiteeApiOperation,
    build: (apiBaseUrl: string) => HttpClientRequest.HttpClientRequest,
  ): Effect.Effect<void, GiteeApiError> =>
    executeRaw(operation, build).pipe(
      Effect.flatMap((response) =>
        HttpClientResponse.matchStatus({
          "2xx": () => Effect.void,
          orElse: (failed) => responseError(operation, failed),
        })(response),
      ),
    );

  const resolveRepository = Effect.fn("GiteeApi.resolveRepository")(function* (input: {
    readonly cwd: string;
    readonly reference?: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly repository?: string;
  }) {
    const runtime = yield* currentConfig;
    if (
      input.context?.provider.kind === "gitee" &&
      !servesProvider(input.context.provider, runtime.host)
    ) {
      return yield* new GiteeRepositoryRemoteNotFoundError({ cwd: input.cwd });
    }
    if (input.repository !== undefined) {
      return yield* requireRepositoryLocator(input.repository);
    }

    const url = input.reference ? URL.parse(input.reference) : null;
    const link = url ? GiteeDefinition.definition.parseChangeRequestUrl(url) : null;
    if (link) return yield* requireRepositoryLocator(link.repository);

    const fromContext =
      input.context?.provider.kind === "gitee"
        ? parseGiteeRemoteUrl(input.context.remoteUrl)
        : null;
    if (fromContext) return fromContext;

    const listRemotes = yield* git
      .remotes(input.cwd)
      .pipe(
        Effect.mapError((cause) => new GiteeRepositoryVcsResolveError({ cwd: input.cwd, cause })),
      );
    const remotes = yield* listRemotes.pipe(
      Effect.mapError((cause) => new GiteeRepositoryRemotesListError({ cwd: input.cwd, cause })),
    );

    for (const remote of remotes.remotes) {
      const recognized = recognizeRemoteWith(GiteeDefinition.definition, remote.url);
      if (!servesProvider(recognized, runtime.host)) continue;
      const parsed = parseGiteeRemoteUrl(remote.url);
      if (parsed) return parsed;
    }

    return yield* new GiteeRepositoryRemoteNotFoundError({ cwd: input.cwd });
  });

  const repoPath = (locator: GiteeRepositoryLocator) =>
    `/repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}`;

  const getRepositoryFromLocator = (locator: GiteeRepositoryLocator) =>
    executeJson(
      "getRepository",
      (base) => HttpClientRequest.get(`${base}${repoPath(locator)}`),
      GiteeRepositorySchema,
    );

  const getRepository = (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly repository?: string;
  }) => resolveRepository(input).pipe(Effect.flatMap(getRepositoryFromLocator));

  const getViewer = Effect.fn("GiteeApi.getViewer")(function* () {
    const user = yield* executeJson(
      "getViewer",
      (base) => HttpClientRequest.get(`${base}/user`),
      GiteeUserSchema,
    );
    if (Option.isNone(nonEmpty(user.login ?? user.name))) {
      return yield* new GiteeViewerUnavailableError();
    }
    return user;
  });

  const getRawPullRequestFromRepository = (locator: GiteeRepositoryLocator, reference: string) =>
    executeJson(
      "getPullRequest",
      (base) =>
        HttpClientRequest.get(
          `${base}${repoPath(locator)}/pulls/${encodeURIComponent(normalizeChangeRequestId(reference))}`,
        ),
      GiteePullRequestSchema,
    );

  const readConfigValueNullable = (cwd: string, key: string) =>
    git.readConfigValue(cwd, key).pipe(Effect.orElseSucceed(() => null));

  const resolveCheckoutRemote = Effect.fn("GiteeApi.resolveCheckoutRemote")(function* (input: {
    readonly cwd: string;
    readonly context?: SourceControlProvider.SourceControlProviderContext;
    readonly destinationRepository: GiteeRepositoryLocator;
    readonly sourceRepositoryName: string;
    readonly isCrossRepository: boolean;
  }) {
    if (!input.isCrossRepository) {
      const context = input.context?.provider.kind === "gitee" ? input.context : undefined;
      const remoteName =
        context?.remoteName ??
        (yield* git.resolvePrimaryRemoteName(input.cwd).pipe(Effect.orElseSucceed(() => null)));
      if (remoteName) {
        const remoteUrl =
          context?.remoteUrl ??
          (yield* readConfigValueNullable(input.cwd, `remote.${remoteName}.url`));
        const repository =
          remoteUrl && (context || recognizeRemoteWith(GiteeDefinition.definition, remoteUrl))
            ? parseGiteeRemoteUrl(remoteUrl)
            : null;
        if (
          repository &&
          `${repository.owner}/${repository.repo}`.toLowerCase() ===
            input.sourceRepositoryName.toLowerCase()
        ) {
          return remoteName;
        }
      }
    }

    const runtime = yield* currentConfig;
    const rawRepo = yield* getRepository({
      cwd: input.cwd,
      repository: input.sourceRepositoryName,
      ...(input.context ? { context: input.context } : {}),
    });
    const cloneUrls = normalizeRepositoryCloneUrls(rawRepo, runtime.apiBaseUrl);
    const originRemoteUrl = yield* git
      .execute({
        operation: "GiteeApi.readOriginRemoteUrl",
        cwd: input.cwd,
        args: ["config", "--get-all", "remote.origin.url"],
      })
      .pipe(
        Effect.map((result) => result.stdout.split("\n", 1)[0]?.trim() || null),
        Effect.orElseSucceed(() => null),
      );
    return yield* git.ensureRemote({
      cwd: input.cwd,
      preferredName: input.isCrossRepository
        ? repositoryOwnerName(input.sourceRepositoryName)
        : input.destinationRepository.owner,
      url: selectCloneUrl({ cloneUrls, originRemoteUrl }),
    });
  });

  const probeFailureAuth = (
    apiHost: string,
    status: number | undefined,
  ): SourceControlProviderAuth => {
    const rejected = status === 401 || status === 403;
    return {
      status: rejected ? "unauthenticated" : "unknown",
      account: Option.none(),
      host: Option.some(apiHost),
      detail: Option.some(
        rejected
          ? "Gitee rejected the configured personal access token. Check it in Settings → Version Control & Issues or GITEE_TOKEN."
          : "A Gitee personal access token is configured, but Gitee could not be reached.",
      ),
    };
  };

  const probeAuth: Effect.Effect<SourceControlProviderAuth, never> = currentConfig.pipe(
    Effect.flatMap((runtime) =>
      runtime.token === null
        ? Effect.succeed<SourceControlProviderAuth>({
            status: "unauthenticated",
            account: Option.none(),
            host: Option.some(runtime.host),
            detail: Option.some(GITEE_UNAUTHENTICATED_DETAIL),
          })
        : executeJson(
            "probeAuth",
            (base) => HttpClientRequest.get(`${base}/user`),
            GiteeUserSchema,
          ).pipe(
            Effect.map((user): SourceControlProviderAuth => ({
              status: "authenticated",
              account: nonEmpty(user.login ?? user.name),
              host: Option.some(runtime.host),
              detail: Option.none(),
            })),
            Effect.catchTags({
              GiteeResponseError: (error) =>
                Effect.succeed(probeFailureAuth(runtime.host, error.status)),
              GiteeResponseBodyReadError: (error) =>
                Effect.succeed(probeFailureAuth(runtime.host, error.status)),
            }),
            Effect.orElseSucceed(() => probeFailureAuth(runtime.host, undefined)),
          ),
    ),
    Effect.catchTags({
      SettingsSecretUnresolvedError: (error) =>
        Effect.succeed<SourceControlProviderAuth>({
          status: "unauthenticated",
          account: Option.none(),
          host: Option.some(GiteeDefinition.GITEE_PUBLIC_HOST),
          detail: Option.some(error.message),
        }),
    }),
  );

  return GiteeApi.of({
    probeAuth,
    getViewer,
    getRepository,
    getRepositoryCloneUrls: Effect.fn("GiteeApi.getRepositoryCloneUrls")(function* (input) {
      const runtime = yield* currentConfig;
      const raw = yield* getRepository(input);
      return normalizeRepositoryCloneUrls(raw, runtime.apiBaseUrl);
    }),
    createRepository: Effect.fn("GiteeApi.createRepository")(function* (input) {
      const runtime = yield* currentConfig;
      const locator = yield* requireRepositoryLocator(input.repository);
      const viewer = yield* getViewer().pipe(Effect.option);
      const viewerLogin = Option.isSome(viewer) ? viewer.value.login?.trim().toLowerCase() : null;
      const isPersonalRepo =
        viewerLogin !== null && viewerLogin === locator.owner.trim().toLowerCase();

      const raw = yield* executeJson(
        "createRepository",
        (base) =>
          HttpClientRequest.post(
            isPersonalRepo
              ? `${base}/user/repos`
              : `${base}/orgs/${encodeURIComponent(locator.owner)}/repos`,
          ).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              name: locator.repo,
              private: input.visibility === "private",
            }),
          ),
        GiteeRepositorySchema,
      );
      return normalizeRepositoryCloneUrls(raw, runtime.apiBaseUrl);
    }),
    getDefaultBranch: Effect.fn("GiteeApi.getDefaultBranch")(function* (input) {
      const repository = yield* getRepository(input);
      return repository.default_branch?.trim() || null;
    }),
    listPullRequests: Effect.fn("GiteeApi.listPullRequests")(function* (input) {
      const locator = yield* resolveRepository(input);
      const branch = SourceControlProvider.sourceBranch(input);
      const owner = sourceOwnerFromInput(input);
      const headParam = owner ? `${owner}:${branch}` : branch;
      const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
      const rows = yield* executeJson(
        "listPullRequests",
        (base) =>
          HttpClientRequest.get(`${base}${repoPath(locator)}/pulls`, {
            urlParams: {
              state: input.state,
              sort: "updated",
              direction: "desc",
              page: "1",
              per_page: String(limit),
              head: headParam,
            },
          }),
        GiteePullRequestListSchema,
      );
      return rows.map(normalizeGiteePullRequestRecord);
    }),
    listRepositoryPullRequests: Effect.fn("GiteeApi.listRepositoryPullRequests")(function* (input) {
      const locator = yield* requireRepositoryLocator(input.repository);
      const urlParams: Record<string, string> = {
        state: input.state,
        sort: "updated",
        direction: "desc",
        page: String(Math.max(1, input.page ?? 1)),
        per_page: String(Math.max(1, Math.min(input.perPage ?? 30, 100))),
      };
      if (input.head !== undefined && input.head.trim().length > 0) {
        urlParams.head = input.head.trim();
      }
      return yield* executeJson(
        "listPullRequests",
        (base) => HttpClientRequest.get(`${base}${repoPath(locator)}/pulls`, { urlParams }),
        GiteePullRequestListSchema,
      );
    }),
    getPullRequest: Effect.fn("GiteeApi.getPullRequest")(function* (input) {
      const locator = yield* resolveRepository(input);
      const raw = yield* getRawPullRequestFromRepository(locator, input.reference);
      return normalizeGiteePullRequestRecord(raw);
    }),
    getRawPullRequestByNumber: Effect.fn("GiteeApi.getRawPullRequestByNumber")(function* (input) {
      const locator = yield* requireRepositoryLocator(input.repository);
      return yield* getRawPullRequestFromRepository(locator, String(input.number));
    }),
    createPullRequest: Effect.fn("GiteeApi.createPullRequest")(function* (input) {
      const locator = yield* resolveRepository(input);
      const body = yield* fileSystem.readFileString(input.bodyFile).pipe(
        Effect.mapError(
          (cause) =>
            new GiteePullRequestBodyReadError({
              cwd: input.cwd,
              bodyFile: input.bodyFile,
              cause,
            }),
        ),
      );
      const branch = SourceControlProvider.sourceBranch(input);
      const sourceOwner = sourceOwnerFromInput(input);
      const head =
        sourceOwner && sourceOwner.toLowerCase() !== locator.owner.toLowerCase()
          ? `${sourceOwner}:${branch}`
          : branch;
      return yield* executeJson(
        "createPullRequest",
        (base) =>
          HttpClientRequest.post(`${base}${repoPath(locator)}/pulls`).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              title: input.title,
              head,
              base: input.target?.refName ?? input.baseBranch,
              body,
              ...(input.draft === true ? { draft: true } : {}),
            }),
          ),
        GiteePullRequestSchema,
      );
    }),
    mergePullRequest: Effect.fn("GiteeApi.mergePullRequest")(function* (input) {
      const locator = yield* requireRepositoryLocator(input.repository);
      yield* executeEmpty("mergePullRequest", (base) =>
        HttpClientRequest.put(`${base}${repoPath(locator)}/pulls/${input.number}/merge`).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            merge_method: giteeMergeMethod(input.mergeMethod),
          }),
        ),
      );
    }),
    updatePullRequest: Effect.fn("GiteeApi.updatePullRequest")(function* (input) {
      const locator = yield* requireRepositoryLocator(input.repository);
      const payload: Record<string, string> = {};
      if (input.title !== undefined) payload.title = input.title;
      if (input.body !== undefined) payload.body = input.body;
      if (input.state !== undefined) payload.state = input.state;
      return yield* executeJson(
        "updatePullRequest",
        (base) =>
          HttpClientRequest.patch(`${base}${repoPath(locator)}/pulls/${input.number}`).pipe(
            HttpClientRequest.bodyJsonUnsafe(payload),
          ),
        GiteePullRequestSchema,
      );
    }),
    listPullRequestFiles: Effect.fn("GiteeApi.listPullRequestFiles")(function* (input) {
      const locator = yield* requireRepositoryLocator(input.repository);
      return yield* executeJson(
        "listPullRequestFiles",
        (base) => HttpClientRequest.get(`${base}${repoPath(locator)}/pulls/${input.number}/files`),
        GiteePullRequestFileListSchema,
      );
    }),
    listPullRequestComments: Effect.fn("GiteeApi.listPullRequestComments")(function* (input) {
      const locator = yield* requireRepositoryLocator(input.repository);
      return yield* executeJson(
        "listPullRequestComments",
        (base) =>
          HttpClientRequest.get(`${base}${repoPath(locator)}/pulls/${input.number}/comments`, {
            urlParams: {
              page: String(Math.max(1, input.page ?? 1)),
              per_page: String(Math.max(1, Math.min(input.perPage ?? 100, 100))),
            },
          }),
        GiteePullRequestCommentListSchema,
      );
    }),
    createPullRequestComment: Effect.fn("GiteeApi.createPullRequestComment")(function* (input) {
      const locator = yield* requireRepositoryLocator(input.repository);
      const payload: Record<string, unknown> = { body: input.body };
      if (input.commitId !== undefined) payload.commit_id = input.commitId;
      if (input.path !== undefined) payload.path = input.path;
      if (input.position !== undefined) payload.position = input.position;
      if (input.inReplyToId !== undefined) payload.in_reply_to_id = input.inReplyToId;
      return yield* executeJson(
        "createPullRequestComment",
        (base) =>
          HttpClientRequest.post(`${base}${repoPath(locator)}/pulls/${input.number}/comments`).pipe(
            HttpClientRequest.bodyJsonUnsafe(payload),
          ),
        GiteePullRequestCommentSchema,
      );
    }),
    updatePullRequestComment: Effect.fn("GiteeApi.updatePullRequestComment")(function* (input) {
      const locator = yield* requireRepositoryLocator(input.repository);
      return yield* executeJson(
        "updatePullRequestComment",
        (base) =>
          HttpClientRequest.patch(
            `${base}${repoPath(locator)}/pulls/comments/${encodeURIComponent(input.commentId)}`,
          ).pipe(HttpClientRequest.bodyJsonUnsafe({ body: input.body })),
        GiteePullRequestCommentSchema,
      );
    }),
    listPullRequestCommits: Effect.fn("GiteeApi.listPullRequestCommits")(function* (input) {
      const locator = yield* requireRepositoryLocator(input.repository);
      return yield* executeJson(
        "listPullRequestCommits",
        (base) =>
          HttpClientRequest.get(`${base}${repoPath(locator)}/pulls/${input.number}/commits`),
        GiteePullRequestCommitListSchema,
      );
    }),
    checkoutPullRequest: Effect.fn("GiteeApi.checkoutPullRequest")(
      function* (input) {
        const destinationRepository = yield* resolveRepository(input);
        const pullRequest = yield* getRawPullRequestFromRepository(
          destinationRepository,
          input.reference,
        );
        const destinationRepositoryName =
          pullRequest.base.repo?.full_name?.trim() ||
          `${destinationRepository.owner}/${destinationRepository.repo}`;
        const sourceRepositoryName =
          pullRequest.head.repo?.full_name?.trim() || destinationRepositoryName;
        const isCrossRepository =
          sourceRepositoryName.toLowerCase() !== destinationRepositoryName.toLowerCase();
        const remoteName = yield* resolveCheckoutRemote({
          cwd: input.cwd,
          destinationRepository,
          sourceRepositoryName,
          isCrossRepository,
          ...(input.context ? { context: input.context } : {}),
        });
        const remoteBranch = pullRequest.head.ref;
        const localBranch = checkoutBranchName({
          pullRequestNumber: pullRequest.number,
          headBranch: remoteBranch,
          isCrossRepository,
        });
        const localBranchNames = yield* git.listLocalBranchNames(input.cwd);
        const localBranchExists = localBranchNames.includes(localBranch);

        if (input.force === true || !localBranchExists) {
          yield* git.fetchRemoteBranch({
            cwd: input.cwd,
            remoteName,
            remoteBranch,
            localBranch,
          });
        } else {
          yield* git.fetchRemoteTrackingBranch({
            cwd: input.cwd,
            remoteName,
            remoteBranch,
          });
        }

        yield* git.setBranchUpstream({
          cwd: input.cwd,
          branch: localBranch,
          remoteName,
          remoteBranch,
        });
        yield* Effect.scoped(git.switchRef({ cwd: input.cwd, refName: localBranch }));
      },
      (effect, input) =>
        effect.pipe(
          Effect.mapError((cause) =>
            isGiteeApiError(cause)
              ? cause
              : new GiteeCheckoutError({
                  cwd: input.cwd,
                  reference: input.reference,
                  cause,
                }),
          ),
        ),
    ),
    isRepositoryStarred: Effect.fn("GiteeApi.isRepositoryStarred")(
      function* (repository: string) {
        const locator = parseGiteeRepositorySlug(repository);
        if (locator === null) return false;
        const response = yield* executeRaw("isRepositoryStarred", (base) =>
          HttpClientRequest.get(
            `${base}/user/starred/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}`,
          ),
        );
        return response.status === 204;
      },
      Effect.orElseSucceed(() => false),
    ),
    starRepository: Effect.fn("GiteeApi.starRepository")(
      function* (repository: string) {
        const locator = parseGiteeRepositorySlug(repository);
        if (locator === null) return false;
        const response = yield* executeRaw("starRepository", (base) =>
          HttpClientRequest.put(
            `${base}/user/starred/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repo)}`,
          ),
        );
        return response.status >= 200 && response.status < 300;
      },
      Effect.orElseSucceed(() => false),
    ),
  });
});

export const layer = Layer.effect(GiteeApi, make);
