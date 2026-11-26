import type { EnvironmentCloudLinkStateResult, EnvironmentId } from "@prismux/core-contracts";

import { usePrimaryEnvironmentId } from "../state/environments";

export interface CloudLinkTarget {
  readonly environmentId: EnvironmentId;
}

export function readCachedCloudLinkState(
  _target: CloudLinkTarget,
): EnvironmentCloudLinkStateResult | null {
  return null;
}

/**
 * Local-only Prismux build: cloud relay linking is excised, so cloud link state
 * always resolves statically to null with zero outbound network traffic.
 */
export function useCloudLinkState(environmentId: EnvironmentId | null) {
  const target: CloudLinkTarget | null = environmentId === null ? null : { environmentId };
  return {
    data: null as EnvironmentCloudLinkStateResult | null,
    error: null as string | null,
    isPending: false,
    refresh: () => {},
    target,
  };
}

export function usePrimaryCloudLinkState() {
  return useCloudLinkState(usePrimaryEnvironmentId());
}
