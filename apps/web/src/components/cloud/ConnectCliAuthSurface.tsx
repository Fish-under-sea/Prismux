import { Link } from "@tanstack/react-router";
import { T, useGT } from "gt-react";

import { Button } from "../ui/button";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";

/**
 * Local-first placeholder for legacy cloud CLI connect links.
 * Prismux connects devices directly using local LAN / Tailscale QR pairing codes.
 */
export function ConnectCliAuthorizeSurface() {
  const gt = useGT();
  return (
    <StandalonePage>
      <StandalonePageHeader
        context={gt("Local pairing")}
        title={gt("Use LAN or QR code pairing")}
        description={gt(
          "Cloud relay CLI authorization is disabled in Prismux. Run `prismux pair` or scan the QR code in Environments & remote access.",
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
