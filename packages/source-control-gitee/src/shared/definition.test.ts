import { recognizeRemoteWith } from "@prismux/source-control-core/shared/definition";
import { describe, expect, it } from "vite-plus/test";

import { definition } from "./definition.ts";

const parse = (url: string) => definition.parseChangeRequestUrl(new URL(url));

describe("Gitee change request URLs", () => {
  it("reads pull request URLs on gitee.com and self-hosted Gitee Enterprise hosts", () => {
    expect(
      definition.isChangeRequestReference(
        "https://gitee.com/Fish-under-sea/Prismux/pulls/42/files",
      ),
    ).toBe(true);
    expect(parse("https://gitee.com/Fish-under-sea/Prismux/pulls/42/files?w=1#diff")).toEqual({
      host: "gitee.com",
      repository: "fish-under-sea/prismux",
      number: 42,
      repositoryUrl: "https://gitee.com/Fish-under-sea/Prismux",
    });
    expect(parse("https://gitee.corp.example.com/team/repo/pulls/7")).toEqual({
      host: "gitee.corp.example.com",
      repository: "team/repo",
      number: 7,
      repositoryUrl: "https://gitee.corp.example.com/team/repo",
    });
  });

  it("leaves non-Gitee hosts and non-PR paths alone", () => {
    expect(parse("https://github.com/owner/repo/pulls/42")).toBeNull();
    expect(parse("https://codeberg.org/owner/repo/pulls/42")).toBeNull();
    expect(definition.isChangeRequestReference("https://gitee.com/owner/repo/issues/I8ABCD")).toBe(
      false,
    );
    expect(definition.isChangeRequestReference("https://gitee.com/owner/repo/pulls/abc")).toBe(
      false,
    );
  });

  it("builds pull request URLs below the repository", () => {
    expect(
      definition.changeRequestUrl({
        host: "gitee.com",
        repository: "Fish-under-sea/Prismux",
        number: 18,
      }),
    ).toBe("https://gitee.com/Fish-under-sea/Prismux/pulls/18");
    expect(
      definition.changeRequestUrl({
        host: "gitee.corp.example.com",
        repository: "team/repo",
        number: 9,
        webUrl: "https://gitee.corp.example.com/team/repo",
      }),
    ).toBe("https://gitee.corp.example.com/team/repo/pulls/9");
  });
});

describe("Gitee issues, commits, and repository pages", () => {
  it("parses both alphanumeric Gitee IIDs and numeric issue URLs", () => {
    expect(
      definition.parseIssueUrl?.(
        new URL("https://gitee.com/Fish-under-sea/Prismux/issues/I8ABCD?from=project-issue"),
        false,
      ),
    ).toEqual({
      host: "gitee.com",
      scope: "fish-under-sea/prismux",
      key: "I8ABCD",
    });
    expect(
      definition.parseIssueUrl?.(new URL("https://gitee.com/owner/repo/issues/i9xyz"), false),
    ).toEqual({
      host: "gitee.com",
      scope: "owner/repo",
      key: "I9XYZ",
    });
    expect(
      definition.parseIssueUrl?.(new URL("https://gitee.com/owner/repo/issues/123"), false),
    ).toEqual({
      host: "gitee.com",
      scope: "owner/repo",
      key: "123",
    });
    expect(
      definition.parseIssueUrl?.(new URL("https://gitee.com/owner/repo/issues/0"), false),
    ).toBeNull();
    expect(
      definition.parseIssueUrl?.(new URL("https://gitee.com/owner/repo/issues/new"), false),
    ).toBeNull();
    expect(
      definition.parseIssueUrl?.(new URL("https://example.test/owner/repo/issues/I8ABCD"), false),
    ).toBeNull();
    expect(
      definition.parseIssueUrl?.(new URL("https://example.test/owner/repo/issues/I8ABCD"), true),
    ).toEqual({
      host: "example.test",
      scope: "owner/repo",
      key: "I8ABCD",
    });
  });

  it("parses and builds commit URLs and repository pages", () => {
    const sha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
    expect(
      definition.parseCommitUrl?.(
        new URL(`https://gitee.com/Fish-under-sea/Prismux/commit/${sha}`),
        false,
      ),
    ).toEqual({
      host: "gitee.com",
      repository: "fish-under-sea/prismux",
      sha,
    });
    expect(
      definition.commitUrl?.({
        host: "gitee.com",
        repository: "Fish-under-sea/Prismux",
        sha,
      }),
    ).toBe(`https://gitee.com/Fish-under-sea/Prismux/commit/${sha}`);
    expect(
      definition.repositoryUrlFromPage?.(
        new URL("https://gitee.com/Fish-under-sea/Prismux/blob/main/README.md"),
        false,
      ),
    ).toBe("https://gitee.com/Fish-under-sea/Prismux");
    expect(
      definition.repositoryUrlFromPage?.(
        new URL("https://gitee.com/Fish-under-sea/Prismux/tree/main"),
        false,
      ),
    ).toBe("https://gitee.com/Fish-under-sea/Prismux");
    expect(
      definition.repositoryUrlFromPage?.(
        new URL("https://gitee.com/Fish-under-sea/Prismux/branches"),
        false,
      ),
    ).toBe("https://gitee.com/Fish-under-sea/Prismux");
    expect(
      definition.repositoryUrlFromPage?.(
        new URL("https://example.test/owner/repo/blob/main/README.md"),
        false,
      ),
    ).toBeNull();
  });
});

describe("Gitee remotes", () => {
  const recognize = (url: string) => recognizeRemoteWith(definition, url);

  it.each([
    "https://gitee.com/Fish-under-sea/Prismux.git",
    "https://gitee.com/Fish-under-sea/Prismux",
    "git@gitee.com:Fish-under-sea/Prismux.git",
    "ssh://git@gitee.com/Fish-under-sea/Prismux.git",
  ])("recognises gitee.com remote %s", (url) => {
    expect(recognize(url)).toEqual({
      kind: "gitee",
      name: "Gitee",
      baseUrl: "https://gitee.com",
    });
  });

  it("recognises self-hosted Gitee Enterprise hosts and ignores unrelated hosts", () => {
    expect(recognize("https://gitee.corp.example.com/team/repo.git")).toEqual({
      kind: "gitee",
      name: "Gitee Enterprise",
      baseUrl: "https://gitee.corp.example.com",
    });
    expect(recognize("git@gitee.corp.example.com:team/repo.git")).toEqual({
      kind: "gitee",
      name: "Gitee Enterprise",
      baseUrl: "https://gitee.corp.example.com",
    });
    expect(recognize("https://notgitee.example.com/team/repo.git")).toBeNull();
  });
});
