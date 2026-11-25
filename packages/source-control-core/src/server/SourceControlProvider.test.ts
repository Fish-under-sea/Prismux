import { assert, it } from "@effect/vitest";

import {
  repositoryPathFromRemoteUrl,
  transportSafeSourceControlErrorValue,
} from "./SourceControlProvider.ts";

it("removes URL credentials, query parameters, and fragments from error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
    "https://example.test/org/repo/pull/42",
  );
});

it.each([
  ["git@github.com:T3Tools/prismux.git", "T3Tools/prismux"],
  ["github.com:T3Tools/prismux.git", "T3Tools/prismux"],
  ["gitlab.com:T3Tools/platform/prismux", "T3Tools/platform/prismux"],
  ["https://github.com/T3Tools/prismux.git", "T3Tools/prismux"],
  ["https://github.com/T3Tools/prismux.git?view=compact", "T3Tools/prismux"],
  ["https://github.com/T3Tools/prismux.git#section", "T3Tools/prismux"],
  ["C:/repos/prismux", null],
])("reads the repository path of %s", (remoteUrl, expected) => {
  assert.strictEqual(repositoryPathFromRemoteUrl(remoteUrl), expected);
});
