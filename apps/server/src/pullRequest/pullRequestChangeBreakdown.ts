import type { PullRequestChangeBreakdown } from "@prismux/core-contracts";
import { summarizeChangedFiles } from "@prismux/core-shared/changedFileKind";
import type { ProviderFileStats } from "@prismux/source-control-core/server/PullRequestProvider";

export function toChangeBreakdown(stats: ProviderFileStats): PullRequestChangeBreakdown {
  if (stats.truncated) return null;
  return summarizeChangedFiles(stats.files);
}
