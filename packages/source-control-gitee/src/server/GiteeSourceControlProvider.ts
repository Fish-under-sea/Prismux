import {
  SourceControlProviderError,
  SourceControlProviderKind,
  type ChangeRequest,
} from "@prismux/core-contracts";
import type { SourceControlApiDiscoverySpec } from "@prismux/source-control-core/server/discovery";
import * as SourceControlProvider from "@prismux/source-control-core/server/SourceControlProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as GiteeApi from "./GiteeApi.ts";
import type { NormalizedGiteePullRequestRecord } from "./giteePullRequests.ts";

const KIND = SourceControlProviderKind.make("gitee");
const isRepositoryLocatorError = Schema.is(GiteeApi.GiteeRepositoryLocatorError);

const repositoryDetail = (error: GiteeApi.GiteeApiError, fallback: string) =>
  isRepositoryLocatorError(error) ? error.detail : fallback;

function toChangeRequest(summary: NormalizedGiteePullRequestRecord): ChangeRequest {
  return {
    provider: KIND,
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    ...(summary.headSha !== undefined ? { headSha: summary.headSha } : {}),
    state: summary.state,
    ...(summary.isDraft === true ? { isDraft: true } : {}),
    updatedAt: summary.updatedAt ?? Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

export const make = Effect.gen(function* () {
  const gitee = yield* GiteeApi.GiteeApi;

  return SourceControlProvider.SourceControlProvider.of({
    kind: KIND,
    createsDraftChangeRequests: true,
    listChangeRequests: Effect.fn("GiteeSourceControlProvider.listChangeRequests")(
      function (input) {
        const source = SourceControlProvider.sourceControlRefFromInput(input);
        return gitee
          .listPullRequests({
            cwd: input.cwd,
            ...(input.context ? { context: input.context } : {}),
            headSelector: input.headSelector,
            ...(source ? { source } : {}),
            state: input.state,
            ...(input.limit !== undefined ? { limit: input.limit } : {}),
          })
          .pipe(
            Effect.map((items) => items.map(toChangeRequest)),
            Effect.mapError(
              (error) =>
                new SourceControlProviderError({
                  provider: KIND,
                  operation: "listChangeRequests",
                  cwd: input.cwd,
                  reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                    input.headSelector,
                  ),
                  detail: "Failed to list Gitee pull requests.",
                  cause: error,
                }),
            ),
          );
      },
    ),
    getChangeRequest: Effect.fn("GiteeSourceControlProvider.getChangeRequest")(function (input) {
      return gitee.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: KIND,
              operation: "getChangeRequest",
              cwd: input.cwd,
              reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.reference,
              ),
              detail: "Failed to get Gitee pull request.",
              cause: error,
            }),
        ),
      );
    }),
    createChangeRequest: Effect.fn("GiteeSourceControlProvider.createChangeRequest")(
      function (input) {
        const source = SourceControlProvider.sourceControlRefFromInput(input);
        return gitee
          .createPullRequest({
            cwd: input.cwd,
            ...(input.context ? { context: input.context } : {}),
            baseBranch: input.baseRefName,
            headSelector: input.headSelector,
            ...(source ? { source } : {}),
            ...(input.target ? { target: input.target } : {}),
            title: input.title,
            bodyFile: input.bodyFile,
            ...(input.draft !== undefined ? { draft: input.draft } : {}),
          })
          .pipe(
            Effect.asVoid,
            Effect.mapError(
              (error) =>
                new SourceControlProviderError({
                  provider: KIND,
                  operation: "createChangeRequest",
                  cwd: input.cwd,
                  reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                    input.headSelector,
                  ),
                  detail: "Failed to create Gitee pull request.",
                  cause: error,
                }),
            ),
          );
      },
    ),
    getRepositoryCloneUrls: Effect.fn("GiteeSourceControlProvider.getRepositoryCloneUrls")(
      function (input) {
        return gitee.getRepositoryCloneUrls(input).pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: KIND,
                operation: "getRepositoryCloneUrls",
                cwd: input.cwd,
                repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                  input.repository,
                ),
                detail: repositoryDetail(error, "Failed to get Gitee repository clone URLs."),
                cause: error,
              }),
          ),
        );
      },
    ),
    createRepository: Effect.fn("GiteeSourceControlProvider.createRepository")(function (input) {
      return gitee.createRepository(input).pipe(
        Effect.mapError(
          (error) =>
            new SourceControlProviderError({
              provider: KIND,
              operation: "createRepository",
              cwd: input.cwd,
              repository: SourceControlProvider.transportSafeSourceControlErrorValue(
                input.repository,
              ),
              detail: repositoryDetail(error, "Failed to create Gitee repository."),
              cause: error,
            }),
        ),
      );
    }),
    getDefaultBranch: Effect.fn("GiteeSourceControlProvider.getDefaultBranch")(function (input) {
      return gitee
        .getDefaultBranch({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new SourceControlProviderError({
                provider: KIND,
                operation: "getDefaultBranch",
                cwd: input.cwd,
                detail: "Failed to get Gitee default branch.",
                cause: error,
              }),
          ),
        );
    }),
    checkoutChangeRequest: Effect.fn("GiteeSourceControlProvider.checkoutChangeRequest")(
      function (input) {
        return gitee
          .checkoutPullRequest({
            cwd: input.cwd,
            ...(input.context ? { context: input.context } : {}),
            reference: input.reference,
            ...(input.force !== undefined ? { force: input.force } : {}),
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new SourceControlProviderError({
                  provider: KIND,
                  operation: "checkoutChangeRequest",
                  cwd: input.cwd,
                  reference: SourceControlProvider.transportSafeSourceControlErrorValue(
                    input.reference,
                  ),
                  detail: "Failed to check out Gitee pull request.",
                  cause: error,
                }),
            ),
          );
      },
    ),
  });
});

export const makeDiscovery = Effect.gen(function* () {
  const gitee = yield* GiteeApi.GiteeApi;

  return {
    type: "api",
    kind: KIND,
    label: "Gitee",
    installHint: GiteeApi.GITEE_INSTALL_HINT,
    probeAuth: gitee.probeAuth,
  } satisfies SourceControlApiDiscoverySpec;
});
