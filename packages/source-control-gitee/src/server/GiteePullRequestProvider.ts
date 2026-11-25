import {
  resolvePullRequestAuthorFilter,
  SourceControlProviderKind,
  type PullRequestCapabilities,
  type PullRequestViewerPermissions,
} from "@prismux/core-contracts";
import {
  PullRequestProviderError,
  type ProviderChangeRequest,
  type ProviderChangeRequestActivity,
  type ProviderChangeRequestDetail,
  type ProviderChangeRequestSummary,
  type PullRequestProviderApi,
  type PullRequestProviderFailure,
} from "@prismux/source-control-core/server/PullRequestProvider";
import * as Effect from "effect/Effect";

import { definition } from "../shared/definition.ts";
import * as GiteeApi from "./GiteeApi.ts";
import {
  buildGiteeUnifiedDiff,
  normalizeGiteeComments,
  normalizeGiteeCommits,
  toGiteePullRequestRecord,
  type GiteePullRequestRecord,
} from "./giteePullRequests.ts";

const KIND = SourceControlProviderKind.make("gitee");

const CAPABILITIES: PullRequestCapabilities = {
  diff: true,
  comment: true,
  actions: [...definition.changeRequestActions],
  mergeMethods: ["merge", "squash", "rebase"],
  search: true,
  reactions: false,
  mentions: false,
  referenceSigils: [],
  labels: false,
  review: {
    inlineComment: true,
    reply: true,
    resolve: false,
    verdicts: ["comment", "approve"],
  },
  reviewers: { request: false, listCandidates: false, searchCandidates: false },
  edit: { changeRequest: true, comment: true },
  viewedFiles: "environment",
};

const UNAVAILABLE_REQUIREMENT = {
  missing:
    "Gitee needs a personal access token. Add one in Settings → Version Control & Issues, or set GITEE_TOKEN.",
  unauthenticated:
    "Gitee rejected the configured personal access token. Check it in Settings → Version Control & Issues or GITEE_TOKEN.",
};

const VIEWER_PERMISSIONS: PullRequestViewerPermissions = {
  actions: [...CAPABILITIES.actions],
  comment: true,
  resolve: false,
  verdicts: [...CAPABILITIES.review.verdicts],
  requestReviewers: false,
  editChangeRequest: true,
};

export function giteeProviderFailure(error: GiteeApi.GiteeApiError): PullRequestProviderFailure {
  if (
    ((error._tag === "GiteeResponseError" || error._tag === "GiteeResponseBodyReadError") &&
      error.status === 401) ||
    error._tag === "SettingsSecretUnresolvedError"
  ) {
    return { reason: "unauthenticated" };
  }
  if (
    (error._tag === "GiteeResponseError" || error._tag === "GiteeResponseBodyReadError") &&
    error.status === 403
  ) {
    return { reason: "forbidden" };
  }
  if (error._tag === "SourceControlRateLimitPausedError") {
    return { reason: "rate-limited", retryAt: error.retryAt };
  }
  if (
    (error._tag === "GiteeResponseError" || error._tag === "GiteeResponseBodyReadError") &&
    error.status === 429
  ) {
    return {
      reason: "rate-limited",
      ...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
    };
  }
  if (
    (error._tag === "GiteeResponseError" || error._tag === "GiteeResponseBodyReadError") &&
    error.status === 404
  ) {
    return { reason: "not-found" };
  }
  return { reason: "failed" };
}

function toProviderChangeRequest(record: GiteePullRequestRecord): ProviderChangeRequest {
  return {
    number: record.number,
    title: record.title,
    url: record.url,
    author: record.author,
    headBranch: record.headBranch,
    ...(record.headRepositoryNameWithOwner !== null
      ? { headRepositoryNameWithOwner: record.headRepositoryNameWithOwner }
      : {}),
    baseBranch: record.baseBranch,
    state: record.state,
    isDraft: record.isDraft,
    mergeability: record.mergeability,
    additions: 0,
    deletions: 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.closedAt !== null ? { closedAt: record.closedAt } : {}),
    ...(record.mergedAt !== null ? { mergedAt: record.mergedAt } : {}),
    reviewRequestLogins: record.reviewRequestLogins,
    labels: record.labels,
  };
}

function toActionSummary(record: GiteePullRequestRecord): ProviderChangeRequestSummary {
  return {
    number: record.number,
    title: record.title,
    url: record.url,
    author: record.author,
    headBranch: record.headBranch,
    baseBranch: record.baseBranch,
    state: record.state,
    isDraft: record.isDraft,
    updatedAt: record.updatedAt,
    ...(record.closedAt !== null ? { closedAt: record.closedAt } : {}),
    ...(record.mergedAt !== null ? { mergedAt: record.mergedAt } : {}),
    ...(record.headSha !== null ? { headSha: record.headSha } : {}),
  };
}

export const make = Effect.gen(function* () {
  const api = yield* GiteeApi.GiteeApi;
  const servesHost = yield* GiteeApi.GiteeServesHost.pipe(Effect.orDie);

  const fail = (operation: string) => (error: GiteeApi.GiteeApiError) =>
    new PullRequestProviderError({
      provider: KIND,
      operation,
      ...giteeProviderFailure(error),
      detail: error._tag === "SettingsSecretUnresolvedError" ? error.message : error.detail,
      cause: error,
    });

  const unsupported = (operation: string, detail: string) =>
    Effect.fail(
      new PullRequestProviderError({
        provider: KIND,
        operation,
        reason: "failed",
        detail,
      }),
    );

  const recoverRead = <A>(read: Effect.Effect<A, GiteeApi.GiteeApiError>, fallback: A) =>
    Effect.catchTags(read, {
      GiteeResponseError: (error) =>
        error.status === 429 || error.status === 401
          ? Effect.fail(error)
          : Effect.succeed(fallback),
      GiteeResponseBodyReadError: (error) =>
        error.status === 429 || error.status === 401
          ? Effect.fail(error)
          : Effect.succeed(fallback),
      GiteeRepositoryLocatorError: () => Effect.succeed(fallback),
      GiteeRequestError: () => Effect.succeed(fallback),
      GiteeResponseDecodeError: () => Effect.succeed(fallback),
      GiteeRepositoryVcsResolveError: () => Effect.succeed(fallback),
      GiteeRepositoryRemotesListError: () => Effect.succeed(fallback),
      GiteeRepositoryRemoteNotFoundError: () => Effect.succeed(fallback),
      GiteePullRequestBodyReadError: () => Effect.succeed(fallback),
      GiteeCheckoutError: () => Effect.succeed(fallback),
      GiteeViewerUnavailableError: () => Effect.succeed(fallback),
    });

  const provider: PullRequestProviderApi = {
    kind: KIND,
    capabilities: CAPABILITIES,
    servesHost,
    unavailableRequirement: UNAVAILABLE_REQUIREMENT,
    readsPublicHostWithoutCheckout: true,

    getViewer: () =>
      api.getViewer().pipe(
        Effect.map((user) => user.login?.trim() || user.name?.trim() || ""),
        Effect.mapError(fail("getViewer")),
      ),

    listChangeRequests: (input) => {
      const perPage = Math.max(1, Math.min(input.limit, 100));
      const page =
        input.cursor !== undefined && input.cursor.delivered > 0
          ? Math.floor(input.cursor.delivered / perPage) + 1
          : 1;
      const authorFilter =
        input.filters?.author === undefined
          ? undefined
          : resolvePullRequestAuthorFilter(input.filters.author, input.viewer).toLowerCase();
      const search = input.query?.trim().toLowerCase() ?? "";

      return api
        .listRepositoryPullRequests({
          repository: input.repository,
          state: input.state,
          page,
          perPage,
        })
        .pipe(
          Effect.mapError(fail("listChangeRequests")),
          Effect.map((rawRows) => {
            const mapped = rawRows.map(toGiteePullRequestRecord);
            const filtered = mapped.filter((row) => {
              if (authorFilter !== undefined && row.author?.login.toLowerCase() !== authorFilter) {
                return false;
              }
              if (input.filters?.draft === "only" && !row.isDraft) return false;
              if (input.filters?.draft === "hide" && row.isDraft) return false;
              if (
                search.length > 0 &&
                !row.title.toLowerCase().includes(search) &&
                !row.body.toLowerCase().includes(search) &&
                !String(row.number).includes(search)
              ) {
                return false;
              }
              return true;
            });
            return {
              items: filtered.slice(0, input.limit).map(toProviderChangeRequest),
              truncated: rawRows.length >= perPage,
              cursorAdvance: rawRows.length,
              continues: rawRows.length >= perPage,
            };
          }),
        );
    },

    getChangeRequestPreview: (input) =>
      api.getRawPullRequestByNumber({ repository: input.repository, number: input.number }).pipe(
        Effect.mapError(fail("getChangeRequestPreview")),
        Effect.map((raw) => {
          const record = toGiteePullRequestRecord(raw);
          return {
            number: record.number,
            title: record.title,
            url: record.url,
            author: record.author,
            state: record.state,
            isDraft: record.isDraft,
            createdAt: record.createdAt,
          };
        }),
      ),

    getChangeRequest: (input) => {
      const target = { repository: input.repository, number: input.number };
      return Effect.all(
        [api.getRawPullRequestByNumber(target), recoverRead(api.listPullRequestFiles(target), [])],
        { concurrency: 2 },
      ).pipe(
        Effect.mapError(fail("getChangeRequest")),
        Effect.map(([rawPullRequest, rawFiles]): ProviderChangeRequestDetail => {
          const record = toGiteePullRequestRecord(rawPullRequest);
          const diff = buildGiteeUnifiedDiff(rawFiles);
          return {
            ...toProviderChangeRequest(record),
            headSha: record.headSha,
            additions: diff.additions,
            deletions: diff.deletions,
            changedFiles: diff.changedFiles,
            body: record.body,
            mergedAt: record.state === "merged" ? (record.mergedAt ?? record.updatedAt) : null,
            closedAt: record.state === "closed" ? (record.closedAt ?? record.updatedAt) : null,
            reviewers: record.reviewers,
            checks: [],
            mergeCapabilities: { merge: true, squash: true, rebase: true },
            viewerPermissions: VIEWER_PERMISSIONS,
          };
        }),
      );
    },

    getChangeRequestActivity: (input) => {
      const target = { repository: input.repository, number: input.number };
      return Effect.all(
        [
          recoverRead(api.listPullRequestComments(target), []),
          recoverRead(api.listPullRequestCommits(target), []),
        ],
        { concurrency: 2 },
      ).pipe(
        Effect.mapError(fail("getChangeRequestActivity")),
        Effect.map(([rawComments, rawCommits]): ProviderChangeRequestActivity => {
          const normalized = normalizeGiteeComments(rawComments);
          return {
            comments: normalized.comments,
            commentCount: normalized.comments.length,
            commentsTruncated: rawComments.length >= 100,
            reviewThreads: normalized.reviewThreads,
            commits: normalizeGiteeCommits(rawCommits),
          };
        }),
      );
    },

    getViewerPermissions: () => Effect.succeed(VIEWER_PERMISSIONS),

    getDiff: (input) =>
      api.listPullRequestFiles({ repository: input.repository, number: input.number }).pipe(
        Effect.mapError(fail("getDiff")),
        Effect.map((files) => {
          const diff = buildGiteeUnifiedDiff(files);
          return { patch: diff.patch, truncated: false, nextCursor: null };
        }),
      ),

    getFileStats: (input) =>
      api.listPullRequestFiles({ repository: input.repository, number: input.number }).pipe(
        Effect.mapError(fail("getFileStats")),
        Effect.map((files) => ({
          files: buildGiteeUnifiedDiff(files).fileStats,
          truncated: false,
        })),
      ),

    getFileRevisions: (input) =>
      api.listPullRequestFiles({ repository: input.repository, number: input.number }).pipe(
        Effect.mapError(fail("getFileRevisions")),
        Effect.map((files) => {
          const diff = buildGiteeUnifiedDiff(files);
          const revisions = new Map(diff.fileRevisions);
          for (const path of input.paths) {
            if (!revisions.has(path)) revisions.set(path, "");
          }
          return { revisions, complete: true };
        }),
      ),

    runAction: (input) => {
      const target = { repository: input.repository, number: input.number };
      if (input.action === "merge") {
        return api
          .mergePullRequest({
            ...target,
            ...(input.mergeMethod === undefined ? {} : { mergeMethod: input.mergeMethod }),
          })
          .pipe(
            Effect.andThen(
              recoverRead(
                api
                  .getRawPullRequestByNumber(target)
                  .pipe(Effect.map((raw) => toActionSummary(toGiteePullRequestRecord(raw)))),
                undefined,
              ),
            ),
            Effect.mapError(fail("runAction")),
          );
      }
      if (input.action === "close" || input.action === "reopen") {
        return api
          .updatePullRequest({
            ...target,
            state: input.action === "close" ? "closed" : "open",
          })
          .pipe(
            Effect.map((raw) => toActionSummary(toGiteePullRequestRecord(raw))),
            Effect.mapError(fail("runAction")),
          );
      }
      return unsupported("runAction", `Gitee does not support ${input.action}.`);
    },

    updateChangeRequest: (input) =>
      api
        .updatePullRequest({
          repository: input.repository,
          number: input.number,
          title: input.title,
          body: input.body,
        })
        .pipe(Effect.asVoid, Effect.mapError(fail("updateChangeRequest"))),

    comment: (input) =>
      api
        .createPullRequestComment({
          repository: input.repository,
          number: input.number,
          body: input.body,
        })
        .pipe(Effect.asVoid, Effect.mapError(fail("comment"))),

    updateComment: (input) =>
      api
        .updatePullRequestComment({
          repository: input.repository,
          commentId: input.commentId,
          body: input.body,
        })
        .pipe(Effect.asVoid, Effect.mapError(fail("updateComment"))),

    submitReview: Effect.fn("GiteePullRequestProvider.submitReview")(
      function* (input) {
        const pullRequest =
          input.comments.length > 0
            ? yield* api.getRawPullRequestByNumber({
                repository: input.repository,
                number: input.number,
              })
            : null;
        const commitId = pullRequest?.head.sha?.trim() || undefined;
        for (const draft of input.comments) {
          const position =
            draft.position.kind === "added"
              ? draft.position.newLine
              : draft.position.kind === "deleted"
                ? draft.position.oldLine
                : draft.position.side === "left"
                  ? draft.position.oldLine
                  : draft.position.newLine;
          yield* api.createPullRequestComment({
            repository: input.repository,
            number: input.number,
            body: draft.body,
            commitId,
            path: draft.path,
            position,
          });
        }
        const trimmedBody = input.body.trim();
        if (trimmedBody.length > 0) {
          yield* api.createPullRequestComment({
            repository: input.repository,
            number: input.number,
            body: trimmedBody,
          });
        }
      },
      (effect) => effect.pipe(Effect.mapError(fail("submitReview"))),
    ),

    listReviewerCandidates: () => Effect.succeed({ candidates: [], truncated: false }),

    setReviewerRequest: () =>
      unsupported("setReviewerRequest", "Requesting reviewers is not supported for Gitee yet."),

    replyToThread: (input) => {
      const parentId = Number.parseInt(input.threadId, 10);
      return api
        .createPullRequestComment({
          repository: input.repository,
          number: input.number,
          body: input.body,
          ...(Number.isSafeInteger(parentId) && parentId > 0 ? { inReplyToId: parentId } : {}),
        })
        .pipe(Effect.asVoid, Effect.mapError(fail("replyToThread")));
    },

    setReaction: () => unsupported("setReaction", "Gitee does not support pull request reactions."),

    setThreadResolution: () =>
      unsupported("setThreadResolution", "Resolving review threads is not supported for Gitee."),
  };

  return provider;
});
