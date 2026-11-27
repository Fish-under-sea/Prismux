import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProviderDriverKind } from "@prismux/core-contracts";
import { T, Var } from "gt-react";
import { InfoIcon } from "lucide-react";

import { PRISMUX_REPOSITORY_URL } from "../../legalLinks";
import { resolveConfiguredProviderDisplayName } from "../../prismux/providerDisplayName";
import { serverEnvironment } from "../../state/server";
import { Alert, AlertDescription } from "../ui/alert";

const MULTIPLE_ACCOUNTS_FAQ_URL = `${PRISMUX_REPOSITORY_URL}#faq`;

const MULTIPLE_ACCOUNTS_WARNED_DRIVERS = new Set<string>(["codex", "claudeAgent"]);

/** Shown while adding a Claude or Codex account when the environment already has one signed in. */
export function MultipleAccountsNote({
  environmentId,
  driver,
}: {
  readonly environmentId: EnvironmentId;
  readonly driver: ProviderDriverKind;
}) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const hasSignedInAccount =
    MULTIPLE_ACCOUNTS_WARNED_DRIVERS.has(driver) &&
    providers?.some(
      (provider) => provider.driver === driver && provider.auth.status === "authenticated",
    );
  if (!hasSignedInAccount) return null;
  const providerName = resolveConfiguredProviderDisplayName({
    driverKind: driver,
    providers,
    settings: serverConfig?.settings,
  });
  return (
    <Alert variant="info" role="note">
      <InfoIcon aria-hidden />
      <AlertDescription>
        <p>
          <T>
            We do not recommend managing multiple <Var>{providerName}</Var> accounts in Prismux.{" "}
            <a
              href={MULTIPLE_ACCOUNTS_FAQ_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              More info
            </a>
          </T>
        </p>
      </AlertDescription>
    </Alert>
  );
}
