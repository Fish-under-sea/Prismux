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
  ["git@github.com:PrismuxTools/prismux.git", "PrismuxTools/prismux"],
  ["github.com:PrismuxTools/prismux.git", "PrismuxTools/prismux"],
  ["gitlab.com:PrismuxTools/platform/prismux", "PrismuxTools/platform/prismux"],
  ["https://github.com/PrismuxTools/prismux.git", "PrismuxTools/prismux"],
  ["https://github.com/PrismuxTools/prismux.git?view=compact", "PrismuxTools/prismux"],
  ["https://github.com/PrismuxTools/prismux.git#section", "PrismuxTools/prismux"],
  ["C:/repos/prismux", null],
])("reads the repository path of %s", (remoteUrl, expected) => {
  assert.strictEqual(repositoryPathFromRemoteUrl(remoteUrl), expected);
});
