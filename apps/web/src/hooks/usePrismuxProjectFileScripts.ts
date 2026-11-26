import {
  PRISMUX_PROJECT_FILE_NAME,
  type EnvironmentId,
  type PrismuxProjectFile,
  type PrismuxProjectFileScript,
} from "@prismux/core-contracts";
import { parsePrismuxProjectFile } from "@prismux/core-shared/prismuxProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<PrismuxProjectFileScript> = [];

export interface PrismuxProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: PrismuxProjectFile | null;
  scripts: ReadonlyArray<PrismuxProjectFileScript>;
}

export function usePrismuxProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): PrismuxProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", PRISMUX_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  if (contents === null) {
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: NO_SCRIPTS,
    } as const;
  }
  const file = parsePrismuxProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function usePrismuxProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<PrismuxProjectFileScript> {
  return usePrismuxProjectFileState(environmentId, cwd).scripts;
}
