import { PRISMUX_PROJECT_FILE_NAME, type EnvironmentId, type PrismuxProjectFile } from "@prismux/core-contracts";
import { parsePrismuxProjectFile } from "@prismux/core-shared/prismuxProjectFile";
import { executeAtomQuery } from "@prismux/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export async function readPrismuxProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<PrismuxProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, PRISMUX_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    PRISMUX_PROJECT_FILE_NAME,
    result._tag === "Success" ? result.value : null,
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parsePrismuxProjectFile(data.contents);
}
