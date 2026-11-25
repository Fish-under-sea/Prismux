import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";

import { Button } from "../ui/button";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";

/**
 * Local-first placeholder for legacy hosted agent-approval links.
 * Prismux authorizes MCP agents directly on the local/LAN environment via `/connect-agent`.
 */
export function ApproveAgentSurface() {
  const gt = useGT();
  return (
    <StandalonePage>
      <StandalonePageHeader
        context={gt("Agent sign-in")}
        title={gt("Use local agent pairing")}
        description={gt(
          "Hosted cloud sign-in is disabled in Prismux. Open Environments & remote access on your computer to pair directly over LAN or QR code.",
        )}
      />
      <div className="mt-6">
        <Button render={<Link to="/settings/connections" />} size="sm">
          <T>Open Environments</T>
        </Button>
      </div>
    </StandalonePage>
  );
}
