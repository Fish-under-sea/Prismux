import type { EnvironmentId } from "@prismux/core-contracts";
import { useState } from "react";
import { msg } from "gt-react";

import { m } from "../i18n/messages";
import { useCloudLinkState } from "./cloudLinkState";
import { useEnvironmentCanConfigureRelay } from "../state/session";

export interface CloudLinkDesiredState {
  readonly managedTunnel: boolean;
  readonly publish: boolean;
  readonly holdWebhooksWhileOffline?: boolean;
}

/**
 * Local-first stub retained for shared UI components: Prismux uses pure LAN/Tailscale QR pairing
 * instead of third-party hosted cloud relay accounts.
 */
export function useCloudLinkController(environmentId: EnvironmentId | null) {
  const cloudLinkState = useCloudLinkState(environmentId);
  const canConfigureRelay = useEnvironmentCanConfigureRelay(environmentId);
  const [operationError, setOperationError] = useState<string | null>(null);

  const reconcileCloudState = async (_desired: CloudLinkDesiredState): Promise<boolean> => {
    setOperationError(m(msg("Cloud relay account linking is disabled in Prismux. Use LAN/QR pairing instead.")));
    return false;
  };

  return {
    isSignedIn: false,
    linkState: cloudLinkState,
    linked: false,
    linkRevoked: false,
    managedTunnelActive: false,
    managedTunnelOutOfSync: false,
    publishAgentActivity: false,
    holdWebhooksWhileOffline: false,
    operationError,
    tunnelLimit: null as number | null,
    needsRelayConfiguration: (_desired: CloudLinkDesiredState) => !canConfigureRelay,
    reconcileCloudState,
  };
}
