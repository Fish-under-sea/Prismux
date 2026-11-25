import {
  makeProviderSettingsSchema,
  SettingsSecretValue,
  SourceControlProviderKind,
  TrimmedString,
} from "@prismux/core-contracts";
import { canonicalRepositoryPath } from "@prismux/core-shared/git";
import { parseUrl } from "@prismux/core-shared/url";
import {
  buildCommitUrl,
  changeRequestUrlBelow,
  defineSourceControl,
  isChangeRequestInProjectRepository,
  isChangeRequestOnProjectHost,
  parseChangeRequestPath,
  parseCommitPath,
  projectChangeRequestHost,
  remoteWebOrigin,
  repositoryUrlFromPagePath,
  type IssueLink,
} from "@prismux/source-control-core/shared/definition";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { icon } from "./icon.ts";

export const GITEE_PUBLIC_HOST = "gitee.com";
export const GITEE_DEFAULT_API_BASE_URL = "https://gitee.com/api/v5";
export const GITEE_TOKENS_URL = "https://gitee.com/profile/personal_access_tokens";

const safeShellArgument = /^[A-Za-z0-9._/@+=,-]+$/;
const CHANGE_REQUEST_PATH = /^\/([^/]+\/[^/]+)\/pulls\/(\d+)(?:\/|$)/u;
const COMMIT_PATH = /^\/([^/]+\/[^/]+)\/(?:commit|pulls\/\d+\/commits)\/([0-9a-f]+)\/?$/iu;
const ISSUE_PATH = /^\/([^/]+\/[^/]+)\/issues\/([A-Za-z0-9]+)(?:\/|$)/u;
const REPOSITORY_PAGE_PATH = /^\/([^/]+\/[^/]+)\/(?:tree|blob|commits|branches)(?:\/|$)/u;

const KIND = SourceControlProviderKind.make("gitee");

export function isGiteeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === GITEE_PUBLIC_HOST ||
    host.endsWith(`.${GITEE_PUBLIC_HOST}`) ||
    host.split(".").includes("gitee")
  );
}

function isRepositoryPath(repository: string): boolean {
  const segments = repository.split("/");
  return (
    segments.length === 2 &&
    segments.every((segment) => /^[\w.-]+$/u.test(segment) && segment !== "." && segment !== "..")
  );
}

/** Gitee issue identifiers are either positive integers or alphanumeric base-36 IIDs (e.g. `I8ABCD`). */
export function parseGiteeIssuePath(url: URL): IssueLink | null {
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const match = ISSUE_PATH.exec(url.pathname);
  const scope = match?.[1];
  const rawKey = match?.[2];
  if (!scope || !rawKey) return null;

  if (/^\d+$/u.test(rawKey)) {
    const number = Number(rawKey);
    if (!Number.isSafeInteger(number) || number <= 0) return null;
    return {
      host: url.hostname.toLowerCase(),
      scope: canonicalRepositoryPath(scope),
      key: String(number),
    };
  }

  const isAlphanumericIid =
    /^I[0-9A-Za-z]{2,}$/u.test(rawKey) ||
    (/^[A-Za-z][A-Za-z0-9]{1,}$/u.test(rawKey) && /\d/u.test(rawKey));
  if (!isAlphanumericIid) return null;

  return {
    host: url.hostname.toLowerCase(),
    scope: canonicalRepositoryPath(scope),
    key: rawKey.toUpperCase(),
  };
}

const text = (annotations: Schema.Annotations.Key<string>) =>
  TrimmedString.pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
    Schema.annotateKey(annotations),
  );

const secret = (annotations: Schema.Annotations.Key<SettingsSecretValue>) =>
  SettingsSecretValue.pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
    Schema.annotateKey({ ...annotations, providerSettingsForm: { control: "password" } }),
  );

export const settings = makeProviderSettingsSchema(
  {
    accessToken: secret({
      title: "Personal access token",
      description:
        "Generate a private token at https://gitee.com/profile/personal_access_tokens (grant projects, pull_requests, user_info). Used before GITEE_TOKEN.",
    }),
    apiBaseUrl: text({
      title: "API base URL",
      description:
        "Optional Gitee Enterprise OpenAPI v5 endpoint. Leave blank for https://gitee.com/api/v5.",
      providerSettingsForm: { placeholder: GITEE_DEFAULT_API_BASE_URL },
    }),
  },
  { order: ["accessToken", "apiBaseUrl"] },
);
export type GiteeSettings = typeof settings.Type;

const changeRequestHeadRef = (number: number) => `refs/pull/${number}/head`;

export const definition = defineSourceControl({
  kind: KIND,
  label: "Gitee",
  pickerLabel: "Gitee",
  icon,
  searchKeywords: ["gitee", "码云", "oschina", "enterprise"],
  changeRequest: {
    shortLabel: "PR",
    shortLabelWithArticle: "a PR",
    singular: "pull request",
    plural: "pull requests",
  },
  repositoryPathHint: "owner/repo",
  publicHost: GITEE_PUBLIC_HOST,
  publishDescription: GITEE_PUBLIC_HOST,
  publishHost: () => GITEE_PUBLIC_HOST,
  newRepositoryOwner: (account) => ({ owner: account }),
  defaultCloneTransport: "https",
  changeRequestUrl: ({ host, repository, number, remoteUrl, webUrl }) => {
    if (!Number.isSafeInteger(number) || number < 1) return null;
    if (webUrl) return changeRequestUrlBelow(webUrl, `pulls/${number}`);
    if (!isRepositoryPath(repository)) return null;
    try {
      return new URL(`/${repository}/pulls/${number}`, remoteWebOrigin(host, remoteUrl)).toString();
    } catch {
      return null;
    }
  },
  parseChangeRequestUrl: (url) =>
    isGiteeHost(url.hostname) ? parseChangeRequestPath(url, CHANGE_REQUEST_PATH) : null,
  commitUrl: (input) =>
    isRepositoryPath(input.repository) ? buildCommitUrl(input, "commit") : null,
  parseCommitUrl: (url, known) =>
    known || isGiteeHost(url.hostname) ? parseCommitPath(url, COMMIT_PATH) : null,
  parseIssueUrl: (url, known) =>
    known || isGiteeHost(url.hostname) ? parseGiteeIssuePath(url) : null,
  repositoryUrlFromPage: (url, known) =>
    known || isGiteeHost(url.hostname)
      ? repositoryUrlFromPagePath(url, REPOSITORY_PAGE_PATH)
      : null,
  changeRequestUrlFromReferenceAutolink: () => null,
  changeRequestActions: new Set(["merge", "close", "reopen"] as const),
  checkoutCommand: ({ number, headBranch, headRepositoryNameWithOwner, repositoryUrl }) => {
    if (repositoryUrl) {
      return `git fetch '${repositoryUrl.replaceAll("'", "'\\''")}' ${changeRequestHeadRef(number)} && git checkout -B pulls/${number} FETCH_HEAD`;
    }
    return headRepositoryNameWithOwner &&
      isRepositoryPath(headRepositoryNameWithOwner) &&
      safeShellArgument.test(headBranch)
      ? `git clone --single-branch --branch ${headBranch} https://gitee.com/${headRepositoryNameWithOwner}.git prismux-pr-${number}`
      : null;
  },
  authorProfileUrl: (login, repositoryUrl) =>
    new URL(`/${encodeURIComponent(login)}`, repositoryUrl).toString(),
  hardLineBreaks: true,
  reviewSummaryRequired: () => false,
  checkoutCommandArgument: () => null,
  isChangeRequestReference: (reference) => {
    const url = parseUrl(reference);
    return (
      url !== null &&
      isGiteeHost(url.hostname) &&
      parseChangeRequestPath(url, CHANGE_REQUEST_PATH) !== null
    );
  },
  checkoutChangeRequestHost: () => null,
  changeRequestHeadRef,
  recognizeRemote: ({ remoteUrl, host, hostname }) =>
    hostname === GITEE_PUBLIC_HOST || hostname.endsWith(`.${GITEE_PUBLIC_HOST}`)
      ? { kind: KIND, name: "Gitee", baseUrl: `https://${GITEE_PUBLIC_HOST}` }
      : hostname.split(".").includes("gitee")
        ? {
            kind: KIND,
            name: "Gitee Enterprise",
            baseUrl: /^https?:/iu.test(remoteUrl) ? new URL(remoteUrl).origin : `https://${host}`,
          }
        : null,
  isChangeRequestInRepository: (identity, link) =>
    isChangeRequestInProjectRepository(projectChangeRequestHost(identity, KIND), identity, link),
  canReadChangeRequestOnHost: (identity, link) =>
    isChangeRequestOnProjectHost(projectChangeRequestHost(identity, KIND), identity, link),
  settings,
});
