import { m } from "../i18n/messages";
import { thrownErrorMessage } from "@prismux/client-runtime/errors";
import { AuthProvidersManageScope } from "@prismux/core-contracts";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@prismux/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { T, useGT } from "gt-react";

import { resolveConfiguredProviderDisplayName } from "~/prismux/providerDisplayName";
import { useEnvironmentProviders, useEnvironments } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentsWithScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  getProviderUpdateRunToastView,
  type ProviderUpdateRun,
} from "./ProviderUpdateLaunchNotification.logic";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

// `refreshModels` always drops the server's hour-long latest-version cache. `modelCatalogOnly`
// drops it only when the model manifest changed.
export function useCheckProviderUpdates() {
  const gt = useGT();
  const { environments } = useEnvironments();
  const manageableIds = useEnvironmentsWithScope(environments, AuthProvidersManageScope);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const inFlight = useRef<Promise<void> | null>(null);

  const check = async (quiet: boolean) => {
    const failures = await Promise.all(
      environments
        .filter(
          (environment) =>
            environment.connection.phase === "connected" &&
            manageableIds.has(environment.environmentId),
        )
        .map(async ({ environmentId, label }) => {
          const result = await refreshProviders({ environmentId, input: { refreshModels: true } });
          if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return [];
          const error = squashAtomCommandFailure(result);
          return [`${label}: ${thrownErrorMessage(error, m) ?? gt("Refresh failed.")}`];
        }),
    );
    const lines = failures.flat();
    if (quiet || lines.length === 0) return;
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: gt("Could not check provider updates"),
        description: <span className="whitespace-pre-line">{lines.join("\n")}</span>,
      }),
    );
  };

  // A repeat click must not start a second model rediscovery while one is running.
  return ({ quiet = false }: { readonly quiet?: boolean } = {}) => {
    if (inFlight.current) return inFlight.current;
    const running = check(quiet).finally(() => {
      inFlight.current = null;
    });
    inFlight.current = running;
    return running;
  };
}

export function useProviderUpdates() {
  const { environments } = useEnvironments();
  const manageableIds = useEnvironmentsWithScope(environments, AuthProvidersManageScope);
  const providersByEnvironment = useEnvironmentProviders();
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    reportFailure: false,
  });
  const machines = environments.flatMap((environment) => {
    const providers = providersByEnvironment.get(environment.environmentId) ?? [];
    if (
      environment.connection.phase !== "connected" ||
      !manageableIds.has(environment.environmentId)
    ) {
      return [];
    }
    const candidates = collectProviderUpdateCandidates(providers).filter((candidate) =>
      canOneClickUpdateProviderCandidate(candidate, providers),
    );
    return candidates.length > 0
      ? [
          {
            environmentId: environment.environmentId,
            label: environment.label,
            providers,
            settings: environment.serverConfig?.settings,
            candidates,
          },
        ]
      : [];
  });

  const updateAll = async ({ quiet = false }: { readonly quiet?: boolean } = {}) => {
    const runs = await Promise.all(
      machines.flatMap(({ environmentId, label, providers, settings, candidates }) =>
        candidates.map(async (candidate): Promise<ProviderUpdateRun> => ({
          environmentId,
          machineLabel: label,
          driver: candidate.driver,
          instanceId: candidate.instanceId,
          displayName: resolveConfiguredProviderDisplayName({
            provider: candidate.instanceId,
            instanceId: candidate.instanceId,
            driverKind: candidate.driver,
            providers,
            settings,
            fallbackDisplayName: candidate.displayName,
          }),
          result: await updateProvider({
            environmentId,
            input: { provider: candidate.driver, instanceId: candidate.instanceId },
          }),
        })),
      ),
    );
    const view = quiet ? null : getProviderUpdateRunToastView(runs);
    if (view) {
      toastManager.add(
        stackedThreadToast({
          ...view,
          description: <span className="whitespace-pre-line">{view.description}</span>,
        }),
      );
    }
    return runs;
  };

  return { machines, updateAll };
}

export function ProviderUpdatesAction() {
  const { machines, updateAll } = useProviderUpdates();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  if (machines.length === 0 && !isPending) {
    return null;
  }

  const handleUpdate = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    await settlePromise(() => updateAll());
    pending.current = false;
    setIsPending(false);
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={isPending}
            onClick={() => void handleUpdate()}
          >
            {isPending ? <T>Updating…</T> : <T>Update all</T>}
          </Button>
        }
      />
      <TooltipPopup side="top">
        {machines.map((machine) => (
          <div key={machine.environmentId}>
            {machine.label}:{" "}
            {machine.candidates
              .map((candidate) =>
                resolveConfiguredProviderDisplayName({
                  provider: candidate.instanceId,
                  instanceId: candidate.instanceId,
                  driverKind: candidate.driver,
                  providers: machine.providers,
                  settings: machine.settings,
                  fallbackDisplayName: candidate.displayName,
                }),
              )
              .join(", ")}
          </div>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
}
