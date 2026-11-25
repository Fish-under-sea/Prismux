import {
  PositiveInt,
  TrimmedNonEmptyString,
  type PullRequestActor,
  type PullRequestComment,
  type PullRequestCommit,
  type PullRequestLabel,
  type PullRequestMergeability,
  type PullRequestReviewThread,
  type PullRequestState,
} from "@prismux/core-contracts";
import { toIsoUtc, trimOptionalString } from "@prismux/source-control-core/server/pullRequestUtils";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface NormalizedGiteePullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly headSha?: string;
  readonly state: PullRequestState;
  readonly isDraft?: boolean;
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GiteePullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly body: string;
  readonly author: PullRequestActor | null;
  readonly headBranch: string;
  readonly headSha: string | null;
  readonly headRepositoryNameWithOwner: string | null;
  readonly baseBranch: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly mergeability: PullRequestMergeability;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly mergedAt: string | null;
  readonly reviewers: ReadonlyArray<PullRequestActor>;
  readonly reviewRequestLogins: ReadonlyArray<string>;
  readonly labels: ReadonlyArray<PullRequestLabel>;
}

export interface GiteeDiffSummary {
  readonly patch: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly fileRevisions: ReadonlyMap<string, string>;
  readonly fileStats: ReadonlyArray<{
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }>;
}

export const GiteeUserSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.Number)),
  login: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  avatar_url: Schema.optional(Schema.NullOr(Schema.String)),
});
export type GiteeUser = typeof GiteeUserSchema.Type;

export const GiteeNamespaceSchema = Schema.Struct({
  path: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
});

export const GiteeRepositoryRefSchema = Schema.Struct({
  full_name: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  ssh_url: Schema.optional(Schema.NullOr(Schema.String)),
  namespace: Schema.optional(Schema.NullOr(GiteeNamespaceSchema)),
  owner: Schema.optional(Schema.NullOr(GiteeUserSchema)),
});

export const GiteeRepositorySchema = Schema.Struct({
  full_name: TrimmedNonEmptyString,
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  ssh_url: Schema.optional(Schema.NullOr(Schema.String)),
  default_branch: Schema.optional(Schema.NullOr(Schema.String)),
  private: Schema.optional(Schema.Boolean),
  namespace: Schema.optional(Schema.NullOr(GiteeNamespaceSchema)),
  owner: Schema.optional(Schema.NullOr(GiteeUserSchema)),
});
export type GiteeRepository = typeof GiteeRepositorySchema.Type;

export const GiteePullRequestBranchSchema = Schema.Struct({
  ref: TrimmedNonEmptyString,
  sha: Schema.optional(Schema.NullOr(Schema.String)),
  label: Schema.optional(Schema.NullOr(Schema.String)),
  repo: Schema.optional(Schema.NullOr(GiteeRepositoryRefSchema)),
});

export const GiteeLabelSchema = Schema.Struct({
  name: TrimmedNonEmptyString,
  color: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

export const GiteePullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  state: Schema.optional(Schema.NullOr(Schema.String)),
  draft: Schema.optional(Schema.NullOr(Schema.Boolean)),
  html_url: TrimmedNonEmptyString,
  created_at: Schema.optional(Schema.NullOr(Schema.String)),
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
  closed_at: Schema.optional(Schema.NullOr(Schema.String)),
  merged_at: Schema.optional(Schema.NullOr(Schema.String)),
  mergeable: Schema.optional(Schema.NullOr(Schema.Boolean)),
  can_merge_check: Schema.optional(Schema.NullOr(Schema.Boolean)),
  user: Schema.optional(Schema.NullOr(GiteeUserSchema)),
  head: GiteePullRequestBranchSchema,
  base: GiteePullRequestBranchSchema,
  assignees: Schema.optional(Schema.NullOr(Schema.Array(GiteeUserSchema))),
  testers: Schema.optional(Schema.NullOr(Schema.Array(GiteeUserSchema))),
  labels: Schema.optional(Schema.NullOr(Schema.Array(GiteeLabelSchema))),
});
export type GiteeRawPullRequest = typeof GiteePullRequestSchema.Type;

export const GiteePullRequestListSchema = Schema.Array(GiteePullRequestSchema);

export const GiteePullRequestCommentSchema = Schema.Struct({
  id: Schema.Number,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  user: Schema.optional(Schema.NullOr(GiteeUserSchema)),
  created_at: Schema.optional(Schema.NullOr(Schema.String)),
  updated_at: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String)),
  path: Schema.optional(Schema.NullOr(Schema.String)),
  position: Schema.optional(Schema.NullOr(Schema.Number)),
  original_position: Schema.optional(Schema.NullOr(Schema.Number)),
  new_line: Schema.optional(Schema.NullOr(Schema.Number)),
  in_reply_to_id: Schema.optional(Schema.NullOr(Schema.Number)),
  comment_type: Schema.optional(Schema.NullOr(Schema.String)),
});
export type GiteeRawComment = typeof GiteePullRequestCommentSchema.Type;
export const GiteePullRequestCommentListSchema = Schema.Array(GiteePullRequestCommentSchema);

const GiteeNumericCountSchema = Schema.Union([Schema.Number, Schema.String]);

const GiteePatchObjectSchema = Schema.Struct({
  diff: Schema.optional(Schema.NullOr(Schema.String)),
  old_path: Schema.optional(Schema.NullOr(Schema.String)),
  new_path: Schema.optional(Schema.NullOr(Schema.String)),
  new_file: Schema.optional(Schema.NullOr(Schema.Boolean)),
  deleted_file: Schema.optional(Schema.NullOr(Schema.Boolean)),
  renamed_file: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

export const GiteePullRequestFileSchema = Schema.Struct({
  sha: Schema.optional(Schema.NullOr(Schema.String)),
  filename: TrimmedNonEmptyString,
  status: Schema.optional(Schema.NullOr(Schema.String)),
  additions: Schema.optional(Schema.NullOr(GiteeNumericCountSchema)),
  deletions: Schema.optional(Schema.NullOr(GiteeNumericCountSchema)),
  patch: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, GiteePatchObjectSchema]))),
});
export type GiteeRawPullRequestFile = typeof GiteePullRequestFileSchema.Type;
export const GiteePullRequestFileListSchema = Schema.Array(GiteePullRequestFileSchema);

export const GiteePullRequestCommitSchema = Schema.Struct({
  sha: TrimmedNonEmptyString,
  commit: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        message: Schema.optional(Schema.NullOr(Schema.String)),
        author: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              name: Schema.optional(Schema.NullOr(Schema.String)),
              date: Schema.optional(Schema.NullOr(Schema.String)),
            }),
          ),
        ),
        committer: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              date: Schema.optional(Schema.NullOr(Schema.String)),
            }),
          ),
        ),
      }),
    ),
  ),
  author: Schema.optional(Schema.NullOr(GiteeUserSchema)),
});
export type GiteeRawPullRequestCommit = typeof GiteePullRequestCommitSchema.Type;
export const GiteePullRequestCommitListSchema = Schema.Array(GiteePullRequestCommitSchema);

function parseCount(value: number | string | null | undefined): number {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  return 0;
}

function toUtcOption(value: string | null | undefined): Option.Option<DateTime.Utc> {
  const trimmed = trimOptionalString(value);
  return trimmed === null ? Option.none() : DateTime.make(trimmed);
}

export function toGiteeActor(raw: GiteeUser | null | undefined): PullRequestActor | null {
  const login = trimOptionalString(raw?.login) ?? trimOptionalString(raw?.name);
  if (login === null) return null;
  return {
    login,
    name: trimOptionalString(raw?.name),
    avatarUrl: trimOptionalString(raw?.avatar_url),
  };
}

export function normalizeGiteePullRequestState(raw: {
  readonly state?: string | null | undefined;
  readonly merged_at?: string | null | undefined;
}): PullRequestState {
  if (trimOptionalString(raw.merged_at) !== null) return "merged";
  switch (raw.state?.trim().toLowerCase()) {
    case "merged":
      return "merged";
    case "closed":
      return "closed";
    case "open":
    default:
      return "open";
  }
}

function repositoryOwner(
  repository: Schema.Schema.Type<typeof GiteeRepositoryRefSchema> | null | undefined,
): string | null {
  if (!repository) return null;
  return (
    trimOptionalString(repository.namespace?.path) ??
    trimOptionalString(repository.owner?.login) ??
    (repository.full_name?.includes("/")
      ? trimOptionalString(repository.full_name.split("/")[0])
      : null)
  );
}

function mergeabilityOf(raw: GiteeRawPullRequest): PullRequestMergeability {
  if (raw.mergeable === true) return "mergeable";
  if (raw.mergeable === false) return "conflicting";
  if (raw.can_merge_check === true) return "mergeable";
  if (raw.can_merge_check === false) return "conflicting";
  return "unknown";
}

export function normalizeGiteePullRequestRecord(
  raw: GiteeRawPullRequest,
): NormalizedGiteePullRequestRecord {
  const headRepositoryNameWithOwner = trimOptionalString(raw.head.repo?.full_name);
  const baseRepositoryNameWithOwner = trimOptionalString(raw.base.repo?.full_name);
  const headSha = trimOptionalString(raw.head.sha);
  const headRepositoryOwnerLogin = repositoryOwner(raw.head.repo);
  const isCrossRepository =
    headRepositoryNameWithOwner !== null &&
    baseRepositoryNameWithOwner !== null &&
    headRepositoryNameWithOwner.toLowerCase() !== baseRepositoryNameWithOwner.toLowerCase();

  return {
    number: raw.number,
    title: raw.title.trim() || `#${raw.number}`,
    url: raw.html_url,
    baseRefName: raw.base.ref,
    headRefName: raw.head.ref,
    ...(headSha !== null ? { headSha } : {}),
    state: normalizeGiteePullRequestState(raw),
    ...(raw.draft === true ? { isDraft: true } : {}),
    updatedAt: toUtcOption(raw.updated_at),
    ...(isCrossRepository ? { isCrossRepository: true } : {}),
    ...(headRepositoryNameWithOwner !== null ? { headRepositoryNameWithOwner } : {}),
    ...(headRepositoryOwnerLogin !== null ? { headRepositoryOwnerLogin } : {}),
  };
}

export function toGiteePullRequestRecord(raw: GiteeRawPullRequest): GiteePullRequestRecord {
  const reviewerMap = new Map<string, PullRequestActor>();
  for (const candidate of [...(raw.assignees ?? []), ...(raw.testers ?? [])]) {
    const actor = toGiteeActor(candidate);
    if (actor !== null && !reviewerMap.has(actor.login.toLowerCase())) {
      reviewerMap.set(actor.login.toLowerCase(), actor);
    }
  }
  const reviewers = [...reviewerMap.values()];
  const labels: PullRequestLabel[] = (raw.labels ?? []).map((label) => ({
    name: label.name,
    color: trimOptionalString(label.color),
    ...(label.description !== undefined ? { description: label.description } : {}),
  }));
  const fallbackIso = "1970-01-01T00:00:00.000Z";
  const createdRaw = trimOptionalString(raw.created_at) ?? trimOptionalString(raw.updated_at);
  const updatedRaw = trimOptionalString(raw.updated_at) ?? createdRaw;

  return {
    number: raw.number,
    title: raw.title.trim() || `#${raw.number}`,
    url: raw.html_url,
    body: raw.body ?? "",
    author: toGiteeActor(raw.user),
    headBranch: raw.head.ref,
    headSha: trimOptionalString(raw.head.sha),
    headRepositoryNameWithOwner: trimOptionalString(raw.head.repo?.full_name),
    baseBranch: raw.base.ref,
    state: normalizeGiteePullRequestState(raw),
    isDraft: raw.draft === true,
    mergeability: mergeabilityOf(raw),
    createdAt: createdRaw === null ? fallbackIso : toIsoUtc(createdRaw),
    updatedAt: updatedRaw === null ? fallbackIso : toIsoUtc(updatedRaw),
    closedAt:
      trimOptionalString(raw.closed_at) === null
        ? null
        : toIsoUtc(trimOptionalString(raw.closed_at)!),
    mergedAt:
      trimOptionalString(raw.merged_at) === null
        ? null
        : toIsoUtc(trimOptionalString(raw.merged_at)!),
    reviewers,
    reviewRequestLogins: reviewers.map((reviewer) => reviewer.login),
    labels,
  };
}

export function normalizeGiteeComments(rawComments: ReadonlyArray<GiteeRawComment>): {
  readonly comments: ReadonlyArray<PullRequestComment>;
  readonly reviewThreads: ReadonlyArray<PullRequestReviewThread>;
} {
  const byId = new Map(rawComments.map((comment) => [comment.id, comment]));
  const rootOf = (comment: GiteeRawComment): GiteeRawComment => {
    let current = comment;
    for (let step = 0; step < byId.size; step += 1) {
      const parentId = current.in_reply_to_id;
      if (parentId == null) return current;
      const parent = byId.get(parentId);
      if (parent === undefined) return current;
      current = parent;
    }
    return current;
  };

  const comments: PullRequestComment[] = [];
  const threadBuckets = new Map<
    number,
    {
      readonly root: GiteeRawComment;
      readonly entries: Array<GiteeRawComment>;
    }
  >();

  for (const raw of rawComments) {
    const body = raw.body ?? "";
    if (body.trim().length === 0) continue;
    const createdAtRaw = trimOptionalString(raw.created_at);
    const createdAt = createdAtRaw === null ? "1970-01-01T00:00:00.000Z" : toIsoUtc(createdAtRaw);
    const path = trimOptionalString(raw.path);
    const isInline = path !== null || raw.comment_type === "diff_comment";

    comments.push({
      id: String(raw.id),
      kind: isInline ? "review-comment" : "issue-comment",
      author: toGiteeActor(raw.user),
      body,
      createdAt,
      url: trimOptionalString(raw.html_url),
      path,
      reviewState: null,
    });

    const root = rootOf(raw);
    const rootPath = trimOptionalString(root.path);
    if (rootPath === null) continue;
    const existing = threadBuckets.get(root.id);
    if (existing === undefined) {
      threadBuckets.set(root.id, { root, entries: [raw] });
    } else {
      existing.entries.push(raw);
    }
  }

  const reviewThreads: PullRequestReviewThread[] = [];
  for (const { root, entries } of threadBuckets.values()) {
    const path = trimOptionalString(root.path);
    if (path === null) continue;
    const lineCandidate = root.new_line ?? root.position ?? root.original_position ?? null;
    const line =
      typeof lineCandidate === "number" && Number.isSafeInteger(lineCandidate) && lineCandidate > 0
        ? lineCandidate
        : null;
    const sorted = entries.toSorted((left, right) =>
      (left.created_at ?? "").localeCompare(right.created_at ?? ""),
    );
    reviewThreads.push({
      id: String(root.id),
      path,
      line,
      side: "right",
      isResolved: false,
      isOutdated: root.position === null && root.original_position !== null,
      comments: sorted.map((entry) => {
        const ts = trimOptionalString(entry.created_at);
        return {
          id: String(entry.id),
          author: toGiteeActor(entry.user),
          body: entry.body ?? "",
          createdAt: ts === null ? "1970-01-01T00:00:00.000Z" : toIsoUtc(ts),
          url: trimOptionalString(entry.html_url),
        };
      }),
    });
  }

  comments.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  return { comments, reviewThreads };
}

export function normalizeGiteeCommits(
  rawCommits: ReadonlyArray<GiteeRawPullRequestCommit>,
): ReadonlyArray<PullRequestCommit> {
  const commits: PullRequestCommit[] = [];
  for (const raw of rawCommits) {
    const dateRaw =
      trimOptionalString(raw.commit?.committer?.date) ??
      trimOptionalString(raw.commit?.author?.date);
    const committedDate = dateRaw === null ? "1970-01-01T00:00:00.000Z" : toIsoUtc(dateRaw);
    const linked = toGiteeActor(raw.author);
    const fallbackName = trimOptionalString(raw.commit?.author?.name);
    const authors: ReadonlyArray<PullRequestActor> =
      linked !== null
        ? [linked]
        : fallbackName !== null
          ? [{ login: fallbackName, name: fallbackName, avatarUrl: null }]
          : [];
    commits.push({
      oid: raw.sha,
      messageHeadline: (raw.commit?.message ?? "").split("\n")[0] ?? "",
      committedDate,
      authors,
    });
  }
  return commits;
}

export function buildGiteeUnifiedDiff(
  files: ReadonlyArray<GiteeRawPullRequestFile>,
): GiteeDiffSummary {
  let additions = 0;
  let deletions = 0;
  const sections: Array<string> = [];
  const fileRevisions = new Map<string, string>();
  const fileStats: Array<{
    readonly path: string;
    readonly additions: number;
    readonly deletions: number;
  }> = [];

  for (const file of files) {
    const added = parseCount(file.additions);
    const removed = parseCount(file.deletions);
    additions += added;
    deletions += removed;

    const patchObj = typeof file.patch === "object" && file.patch !== null ? file.patch : null;
    const rawDiff =
      typeof file.patch === "string" ? file.patch : (trimOptionalString(patchObj?.diff) ?? "");
    const status = file.status?.trim().toLowerCase() ?? "";
    const isNew = patchObj?.new_file === true || status === "added";
    const isDeleted =
      patchObj?.deleted_file === true || status === "removed" || status === "deleted";
    const oldPath = trimOptionalString(patchObj?.old_path) ?? file.filename;
    const newPath = trimOptionalString(patchObj?.new_path) ?? file.filename;

    fileStats.push({ path: newPath, additions: added, deletions: removed });
    const sha = trimOptionalString(file.sha);
    if (sha !== null) {
      fileRevisions.set(isDeleted ? oldPath : newPath, isDeleted ? "" : sha);
    }

    if (rawDiff.startsWith("diff --git ")) {
      sections.push(rawDiff.endsWith("\n") ? rawDiff : `${rawDiff}\n`);
      continue;
    }

    const headerLines = [`diff --git a/${oldPath} b/${newPath}`];
    if (isNew) {
      headerLines.push("new file mode 100644");
      headerLines.push("--- /dev/null");
      headerLines.push(`+++ b/${newPath}`);
    } else if (isDeleted) {
      headerLines.push("deleted file mode 100644");
      headerLines.push(`--- a/${oldPath}`);
      headerLines.push("+++ /dev/null");
    } else {
      if (patchObj?.renamed_file === true || (oldPath !== newPath && status === "renamed")) {
        headerLines.push(`rename from ${oldPath}`);
        headerLines.push(`rename to ${newPath}`);
      }
      headerLines.push(`--- a/${oldPath}`);
      headerLines.push(`+++ b/${newPath}`);
    }
    if (rawDiff.length > 0) {
      headerLines.push(rawDiff.endsWith("\n") ? rawDiff.slice(0, -1) : rawDiff);
    }
    sections.push(`${headerLines.join("\n")}\n`);
  }

  return {
    patch: sections.join(""),
    additions,
    deletions,
    changedFiles: files.length,
    fileRevisions,
    fileStats,
  };
}
