import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@prismux/core-contracts";
import { Atom } from "effect/reactivity";
import { useGT } from "gt-react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useAccessEnvironment } from "../settings/useAccessEnvironment";
import { Dialog } from "../ui/dialog";
import { WizardHeader, WizardPanel, WizardPopup } from "../ui/wizard";

const requestAtom = Atom.make<{ readonly environmentId: EnvironmentId | null } | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mcp:use-in-another-app"),
);

/** Opens the dialog for `environmentId`, or for the one Sharing & access picks when null. */
export function openUseInAnotherApp(environmentId: EnvironmentId | null): void {
  appAtomRegistry.set(requestAtom, { environmentId });
}

const close = () => appAtomRegistry.set(requestAtom, null);

/** Hosted once at the root, so Cmd-K and Settings can open it from anywhere. */
export function UseInAnotherAppDialogHost() {
  const request = useAtomValue(requestAtom);
  return request === null ? null : <UseInAnotherAppDialog requested={request.environmentId} />;
}

function UseInAnotherAppDialog({ requested }: { readonly requested: EnvironmentId | null }) {
  const { environment, label } = useAccessEnvironment(requested);
  const gt = useGT();
  const title = `${gt("Use Prismux in another app (MCP)")} · ${label ?? "Prismux"}`;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <WizardPopup>
        <WizardHeader title={title} />
        <WizardPanel>
          <div className="space-y-1.5 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
            <p className="font-medium text-foreground">
              {environment === null
                ? gt("Connect to an environment first.")
                : gt("Cloud relay is disabled in local-only Prismux.")}
            </p>
            <p className="text-xs text-muted-foreground">
              {gt(
                "Prismux runs strictly locally with zero cloud relay. Pair remote clients over LAN or Tailscale using the QR pairing dialog.",
              )}
            </p>
          </div>
        </WizardPanel>
      </WizardPopup>
    </Dialog>
  );
}
