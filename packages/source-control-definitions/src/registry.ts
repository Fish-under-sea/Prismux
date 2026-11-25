import * as AzureDevOps from "@prismux/source-control-azure-devops/shared/definition";
import * as Bitbucket from "@prismux/source-control-bitbucket/shared/definition";
import { makeSourceControlDefinitionRegistry } from "@prismux/source-control-core/shared/definition";
import * as Forgejo from "@prismux/source-control-forgejo/shared/definition";
import * as GitCafe from "@prismux/source-control-gitcafe/shared/definition";
import * as Gitee from "@prismux/source-control-gitee/shared/definition";
import * as GitHub from "@prismux/source-control-github/shared/definition";
import * as GitLab from "@prismux/source-control-gitlab/shared/definition";
import * as TanStackSource from "@prismux/source-control-tanstack-source/shared/definition";

export { canonicalizePullRequestUrl as canonicalizeGitCafePullRequestUrl } from "@prismux/source-control-gitcafe/shared/definition";

/**
 * GitHub comes first as the client default for unknown hosts. GitCafe, TanStack Source and Gitee
 * claim URLs first: GitHub and Forgejo accept the same routes on any hostname. TanStack Source is a
 * private beta: every reader knows its URLs, and only a server with its flag on offers the forge.
 */
export const builtInSourceControlDefinitions = makeSourceControlDefinitionRegistry(
  [
    GitHub.definition,
    Gitee.definition,
    GitLab.definition,
    GitCafe.definition,
    TanStackSource.definition,
    Forgejo.definition,
    Bitbucket.definition,
    AzureDevOps.definition,
  ],
  {
    claimChangeRequestUrlsFirst: [
      GitCafe.definition.kind,
      TanStackSource.definition.kind,
      Gitee.definition.kind,
      AzureDevOps.definition.kind,
    ],
    recognizeRemotesIn: [
      GitCafe.definition.kind,
      TanStackSource.definition.kind,
      Gitee.definition.kind,
      Forgejo.definition.kind,
      GitHub.definition.kind,
      GitLab.definition.kind,
      AzureDevOps.definition.kind,
      Bitbucket.definition.kind,
    ],
  },
);
