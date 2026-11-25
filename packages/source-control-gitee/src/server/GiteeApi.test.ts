import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, SourceControlProviderKind } from "@prismux/core-contracts";
import type * as SourceControlHost from "@prismux/source-control-core/server/SourceControlHost";
import * as SourceControlRateLimit from "@prismux/source-control-core/server/SourceControlRateLimit";
import * as TestSourceControlHost from "@prismux/source-control-testing/TestSourceControlHost";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as GiteeApi from "./GiteeApi.ts";
import * as GiteePullRequestProvider from "./GiteePullRequestProvider.ts";

type HostGit = SourceControlHost.SourceControlHost["Service"]["git"];

const samplePullRequest = {
  number: 42,
  title: "Add Gitee OpenAPI v5 provider",
  body: "Implements Gitee source control support.",
  state: "open",
  draft: false,
  html_url: "https://gitee.com/Fish-under-sea/Prismux/pulls/42",
  created_at: "2026-01-01T10:00:00+08:00",
  updated_at: "2026-01-02T08:00:00+08:00",
  closed_at: null,
  merged_at: null,
  mergeable: true,
  user: {
    id: 101,
    login: "fish-under-sea",
    name: "Fish",
    avatar_url: "https://gitee.com/assets/avatar.png",
  },
  head: {
    ref: "feat/gitee",
    sha: "1111111111111111111111111111111111111111",
    repo: {
      full_name: "contributor/Prismux",
      namespace: { path: "contributor" },
    },
  },
  base: {
    ref: "main",
    sha: "2222222222222222222222222222222222222222",
    repo: {
      full_name: "Fish-under-sea/Prismux",
      namespace: { path: "Fish-under-sea" },
    },
  },
  assignees: [],
  testers: [],
  labels: [{ name: "enhancement", color: "c71d23" }],
};

const sampleRepository = {
  full_name: "Fish-under-sea/Prismux",
  html_url: "https://gitee.com/Fish-under-sea/Prismux.git",
  ssh_url: "git@gitee.com:Fish-under-sea/Prismux.git",
  default_branch: "main",
  private: false,
};

const gitOutput = (stdout: string) => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeLayer(input: {
  readonly response: (request: HttpClientRequest.HttpClientRequest) => Response;
  readonly env?: Record<string, string>;
  readonly giteeSettings?: Record<string, unknown>;
  readonly remoteUrl?: string;
  readonly git?: Partial<HostGit>;
}) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, input.response(request))),
  );
  const gitMock = {
    execute: vi.fn<HostGit["execute"]>(() =>
      Effect.succeed(gitOutput("https://gitee.com/Fish-under-sea/Prismux.git\n")),
    ),
    readConfigValue: vi.fn<HostGit["readConfigValue"]>(() =>
      Effect.succeed<string | null>("https://gitee.com/Fish-under-sea/Prismux.git"),
    ),
    resolvePrimaryRemoteName: vi.fn<HostGit["resolvePrimaryRemoteName"]>(() =>
      Effect.succeed("origin"),
    ),
    ensureRemote: vi.fn<HostGit["ensureRemote"]>(() => Effect.succeed("contributor")),
    fetchRemoteBranch: vi.fn<HostGit["fetchRemoteBranch"]>(() => Effect.void),
    fetchRemoteTrackingBranch: vi.fn<HostGit["fetchRemoteTrackingBranch"]>(() => Effect.void),
    setBranchUpstream: vi.fn<HostGit["setBranchUpstream"]>(() => Effect.void),
    switchRef: vi.fn<HostGit["switchRef"]>((request) =>
      Effect.succeed({ refName: request.refName }),
    ),
    listLocalBranchNames: vi.fn<HostGit["listLocalBranchNames"]>(() => Effect.succeed([])),
  };
  const listRemotes = vi.fn(() =>
    Effect.succeed({
      remotes: [
        {
          name: "origin",
          url: input.remoteUrl ?? "https://gitee.com/Fish-under-sea/Prismux.git",
          pushUrl: Option.none(),
          isPrimary: true,
        },
      ],
      freshness: {
        source: "live-local" as const,
        observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
        expiresAt: Option.none(),
      },
    }),
  );
  const resolve = vi.fn((_cwd: string) => Effect.succeed(Effect.suspend(listRemotes)));
  const settings = input.giteeSettings
    ? {
        ...DEFAULT_SERVER_SETTINGS,
        sourceControlHosts: {
          ...DEFAULT_SERVER_SETTINGS.sourceControlHosts,
          gitee: input.giteeSettings,
        },
      }
    : DEFAULT_SERVER_SETTINGS;

  const envConfig = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: input.env ?? {
        GITEE_TOKEN: "gitee_pat_test_123",
      },
    }),
  );

  const layer = GiteeApi.layer.pipe(
    Layer.provide(SourceControlRateLimit.layer),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => execute(request)),
      ),
    ),
    Layer.provide(envConfig),
    Layer.provideMerge(
      TestSourceControlHost.layer({
        settings,
        git: { ...gitMock, ...input.git, remotes: resolve },
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

  return { execute, git: gitMock, layer, envConfig };
}

it.effect("probes auth with GET /user and reports authenticated user login", () => {
  const { execute, layer } = makeLayer({
    response: () =>
      Response.json({
        id: 1,
        login: "fish-under-sea",
        name: "Fish",
        avatar_url: "https://gitee.com/assets/avatar.png",
      }),
  });

  return Effect.gen(function* () {
    const api = yield* GiteeApi.GiteeApi;
    const auth = yield* api.probeAuth;

    assert.deepStrictEqual(auth, {
      status: "authenticated",
      account: Option.some("fish-under-sea"),
      host: Option.some("gitee.com"),
      detail: Option.none(),
    });
    const req = execute.mock.calls[0]?.[0];
    assert.strictEqual(req?.url, "https://gitee.com/api/v5/user");
    assert.strictEqual(req?.headers.authorization, "Bearer gitee_pat_test_123");
  }).pipe(Effect.provide(layer));
});

it.effect("returns clean unauthenticated setup guidance when no Gitee token is configured", () => {
  const { execute, layer } = makeLayer({
    env: {},
    response: () => Response.json({}, { status: 401 }),
  });

  return Effect.gen(function* () {
    const api = yield* GiteeApi.GiteeApi;
    const auth = yield* api.probeAuth;

    assert.deepStrictEqual(auth, {
      status: "unauthenticated",
      account: Option.none(),
      host: Option.some("gitee.com"),
      detail: Option.some(
        "Available. Add a Gitee personal access token in Settings → Version Control & Issues, or set GITEE_TOKEN.",
      ),
    });
    assert.strictEqual(execute.mock.calls.length, 0);
  }).pipe(Effect.provide(layer));
});

it.effect(
  "prefers saved Settings accessToken and custom Gitee Enterprise apiBaseUrl over env",
  () => {
    const { execute, layer } = makeLayer({
      env: { GITEE_TOKEN: "env_token_ignored" },
      giteeSettings: {
        accessToken: "settings_token_wins",
        apiBaseUrl: "https://gitee.corp.example/api/v5/",
      },
      response: () =>
        Response.json({
          id: 2,
          login: "enterprise-user",
          name: "Enterprise User",
        }),
    });

    return Effect.gen(function* () {
      const api = yield* GiteeApi.GiteeApi;
      const auth = yield* api.probeAuth;

      assert.deepStrictEqual(auth, {
        status: "authenticated",
        account: Option.some("enterprise-user"),
        host: Option.some("gitee.corp.example"),
        detail: Option.none(),
      });
      const req = execute.mock.calls[0]?.[0];
      assert.strictEqual(req?.url, "https://gitee.corp.example/api/v5/user");
      assert.strictEqual(req?.headers.authorization, "Bearer settings_token_wins");
    }).pipe(Effect.provide(layer));
  },
);

it.effect("resolves repository clone URLs, creates personal vs org repos, and stars repos", () => {
  const { execute, layer } = makeLayer({
    response: (request) => {
      if (request.url.endsWith("/user")) {
        return Response.json({ id: 1, login: "fish-under-sea", name: "Fish" });
      }
      if (request.url.endsWith("/user/starred/Fish-under-sea/Prismux")) {
        return new Response(null, { status: 204 });
      }
      if (request.url.endsWith("/user/repos") || request.url.endsWith("/orgs/acme/repos")) {
        const isOrg = request.url.includes("/orgs/acme/");
        return Response.json({
          full_name: isOrg ? "acme/demo" : "fish-under-sea/demo",
          html_url: isOrg ? "https://gitee.com/acme/demo" : "https://gitee.com/fish-under-sea/demo",
          ssh_url: isOrg ? "git@gitee.com:acme/demo.git" : "git@gitee.com:fish-under-sea/demo.git",
          default_branch: "main",
        });
      }
      return Response.json(sampleRepository);
    },
  });

  return Effect.gen(function* () {
    const api = yield* GiteeApi.GiteeApi;

    const cloneUrls = yield* api.getRepositoryCloneUrls({
      cwd: "/repo",
      repository: "Fish-under-sea/Prismux",
    });
    assert.deepStrictEqual(cloneUrls, {
      nameWithOwner: "Fish-under-sea/Prismux",
      url: "https://gitee.com/Fish-under-sea/Prismux.git",
      sshUrl: "git@gitee.com:Fish-under-sea/Prismux.git",
    });

    const personalCreated = yield* api.createRepository({
      cwd: "/repo",
      repository: "fish-under-sea/demo",
      visibility: "private",
    });
    assert.strictEqual(personalCreated.url, "https://gitee.com/fish-under-sea/demo.git");

    const orgCreated = yield* api.createRepository({
      cwd: "/repo",
      repository: "acme/demo",
      visibility: "public",
    });
    assert.strictEqual(orgCreated.url, "https://gitee.com/acme/demo.git");

    assert.strictEqual(yield* api.isRepositoryStarred("Fish-under-sea/Prismux"), true);
    assert.strictEqual(yield* api.starRepository("Fish-under-sea/Prismux"), true);

    const urls = execute.mock.calls.map(([request]) => `${request.method} ${request.url}`);
    assert.include(urls, "GET https://gitee.com/api/v5/repos/Fish-under-sea/Prismux");
    assert.include(urls, "POST https://gitee.com/api/v5/user/repos");
    assert.include(urls, "POST https://gitee.com/api/v5/orgs/acme/repos");
    assert.include(urls, "GET https://gitee.com/api/v5/user/starred/Fish-under-sea/Prismux");
    assert.include(urls, "PUT https://gitee.com/api/v5/user/starred/Fish-under-sea/Prismux");
  }).pipe(Effect.provide(layer));
});

it.effect(
  "supports pull request CRUD, files/diff, comments, merge, and close via OpenAPI v5",
  () => {
    const { execute, layer, envConfig } = makeLayer({
      response: (request) => {
        if (request.method === "GET" && request.url.includes("/pulls/42/files")) {
          return Response.json([
            {
              sha: "abcdef1234567890",
              filename: "src/index.ts",
              status: "modified",
              additions: "3",
              deletions: "1",
              patch: {
                diff: "@@ -1,2 +1,4 @@\n-old\n+new\n+line2\n+line3\n",
                old_path: "src/index.ts",
                new_path: "src/index.ts",
              },
            },
          ]);
        }
        if (request.method === "GET" && request.url.includes("/pulls/42/comments")) {
          return Response.json([
            {
              id: 501,
              body: "Looks great!",
              user: { login: "reviewer", name: "Reviewer", avatar_url: null },
              created_at: "2026-01-02T09:00:00+08:00",
              html_url: "https://gitee.com/Fish-under-sea/Prismux/pulls/42#note_501",
              comment_type: "pr_comment",
            },
          ]);
        }
        if (request.method === "GET" && request.url.includes("/pulls/42/commits")) {
          return Response.json([
            {
              sha: "1111111111111111111111111111111111111111",
              commit: {
                message: "feat: add gitee provider\n\ndetails",
                author: { name: "Fish", date: "2026-01-01T10:00:00+08:00" },
              },
              author: { login: "fish-under-sea", name: "Fish", avatar_url: null },
            },
          ]);
        }
        if (request.method === "POST" && request.url.includes("/pulls/42/comments")) {
          return Response.json({
            id: 502,
            body: "Ship it",
            created_at: "2026-01-02T10:00:00+08:00",
          });
        }
        if (request.method === "PUT" && request.url.includes("/pulls/42/merge")) {
          return new Response(null, { status: 200 });
        }
        if (request.method === "PATCH" && request.url.includes("/pulls/42")) {
          return Response.json({ ...samplePullRequest, state: "closed" });
        }
        if (request.method === "POST" && request.url.endsWith("/pulls")) {
          return Response.json(samplePullRequest);
        }
        if (request.method === "GET" && request.url.includes("/pulls/42")) {
          return Response.json(samplePullRequest);
        }
        return Response.json([samplePullRequest]);
      },
    });

    return Effect.gen(function* () {
      const api = yield* GiteeApi.GiteeApi;
      const prProvider = yield* GiteePullRequestProvider.make.pipe(Effect.provide(envConfig));
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-gitee-test-" });
      const bodyFile = `${tempDir}/pr-body.md`;
      yield* fs.writeFileString(bodyFile, "PR body content");

      const pr = yield* api.getPullRequest({
        cwd: "/repo",
        reference: "https://gitee.com/Fish-under-sea/Prismux/pulls/42",
      });
      assert.strictEqual(pr.number, 42);
      assert.strictEqual(pr.state, "open");
      assert.strictEqual(pr.isCrossRepository, true);
      assert.strictEqual(pr.headRepositoryOwnerLogin, "contributor");

      const list = yield* prProvider.listChangeRequests({
        cwd: "/repo",
        host: "gitee.com",
        repository: "Fish-under-sea/Prismux",
        state: "open",
        involvement: "all",
        viewer: "fish-under-sea",
        limit: 20,
      });
      assert.strictEqual(list.items.length, 1);
      assert.strictEqual(list.items[0]?.number, 42);

      const detail = yield* prProvider.getChangeRequest({
        cwd: "/repo",
        host: "gitee.com",
        repository: "Fish-under-sea/Prismux",
        number: 42,
      });
      assert.strictEqual(detail.additions, 3);
      assert.strictEqual(detail.deletions, 1);
      assert.strictEqual(detail.changedFiles, 1);

      const diff = yield* prProvider.getDiff({
        cwd: "/repo",
        host: "gitee.com",
        repository: "Fish-under-sea/Prismux",
        number: 42,
      });
      assert.include(diff.patch, "diff --git a/src/index.ts b/src/index.ts");
      assert.include(diff.patch, "+new");

      const activity = yield* prProvider.getChangeRequestActivity({
        cwd: "/repo",
        host: "gitee.com",
        repository: "Fish-under-sea/Prismux",
        number: 42,
      });
      assert.strictEqual(activity.commentCount, 1);
      assert.strictEqual(activity.commits[0]?.messageHeadline, "feat: add gitee provider");

      yield* api.createPullRequest({
        cwd: "/repo",
        baseBranch: "main",
        headSelector: "feat/gitee",
        title: "Add Gitee OpenAPI v5 provider",
        bodyFile,
      });
      yield* prProvider.comment({
        cwd: "/repo",
        host: "gitee.com",
        repository: "Fish-under-sea/Prismux",
        number: 42,
        body: "Ship it",
      });
      yield* prProvider.runAction({
        cwd: "/repo",
        host: "gitee.com",
        repository: "Fish-under-sea/Prismux",
        number: 42,
        action: "merge",
        mergeMethod: "squash",
      });
      const closed = yield* prProvider.runAction({
        cwd: "/repo",
        host: "gitee.com",
        repository: "Fish-under-sea/Prismux",
        number: 42,
        action: "close",
      });
      assert.strictEqual(closed ? closed.state : undefined, "closed");

      const calls = execute.mock.calls.map(([request]) => `${request.method} ${request.url}`);
      assert.include(calls, "POST https://gitee.com/api/v5/repos/Fish-under-sea/Prismux/pulls");
      assert.include(
        calls,
        "POST https://gitee.com/api/v5/repos/Fish-under-sea/Prismux/pulls/42/comments",
      );
      assert.include(
        calls,
        "PUT https://gitee.com/api/v5/repos/Fish-under-sea/Prismux/pulls/42/merge",
      );
      assert.include(calls, "PATCH https://gitee.com/api/v5/repos/Fish-under-sea/Prismux/pulls/42");
    }).pipe(Effect.scoped, Effect.provide(layer));
  },
);

it.effect("checks out cross-repository Gitee pull requests onto an isolated local branch", () => {
  const { git, layer } = makeLayer({
    response: (request) =>
      request.url.includes("/pulls/42")
        ? Response.json(samplePullRequest)
        : Response.json({
            full_name: "contributor/Prismux",
            html_url: "https://gitee.com/contributor/Prismux.git",
            ssh_url: "git@gitee.com:contributor/Prismux.git",
            default_branch: "main",
          }),
  });

  return Effect.gen(function* () {
    const api = yield* GiteeApi.GiteeApi;
    yield* api.checkoutPullRequest({
      cwd: "/repo",
      reference: "42",
      context: {
        provider: {
          kind: SourceControlProviderKind.make("gitee"),
          name: "Gitee",
          baseUrl: "https://gitee.com",
        },
        remoteName: "origin",
        remoteUrl: "https://gitee.com/Fish-under-sea/Prismux.git",
      },
    });

    assert.deepStrictEqual(git.ensureRemote.mock.calls[0]?.[0], {
      cwd: "/repo",
      preferredName: "contributor",
      url: "https://gitee.com/contributor/Prismux.git",
    });
    assert.deepStrictEqual(git.fetchRemoteBranch.mock.calls[0]?.[0], {
      cwd: "/repo",
      remoteName: "contributor",
      remoteBranch: "feat/gitee",
      localBranch: "prismux/pr-42/feat/gitee",
    });
    assert.deepStrictEqual(git.switchRef.mock.calls[0]?.[0], {
      cwd: "/repo",
      refName: "prismux/pr-42/feat/gitee",
    });
  }).pipe(Effect.provide(layer));
});
