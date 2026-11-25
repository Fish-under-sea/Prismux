import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@prismux/client-runtime/state/models";
import { resolveProviderInstanceDisplayName } from "@prismux/client-runtime/state/provider-instance-display";
import type { ServerSettings } from "@prismux/core-contracts";
import { Atom } from "effect/reactivity";
import { CircleAlertIcon, GitBranchIcon } from "lucide-react";
import { useGT } from "gt-react";

import { useSupportsMultiplePullRequests } from "~/hooks/useSupportsMultiplePullRequests";
import { resolveProviderEntryDisplayName } from "~/prismux/agentBrand";
import {
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
  providerInstanceEntriesFor,
} from "~/providerInstances";
import type { useProject } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { getTriggerDisplayModelName } from "./chat/providerIconUtils";
import { ProviderInstanceIcon } from "./chat/ProviderInstanceIcon";
import { ProjectFavicon } from "./ProjectFavicon";
import { ThreadHoverCard } from "./ThreadHoverCard";
import { ThreadPullRequestsMiniList } from "./ThreadStatusIndicators";
import { MiddleTruncate } from "./ui/middle-truncate";

type ChipProject = NonNullable<ReturnType<typeof useProject>>;

const noThreadChipServerSettingsAtom = Atom.make<ServerSettings | null>(null);

export function ThreadChipHoverCard(props: {
  title: string;
  project: ChipProject | null;
  shell: EnvironmentThreadShell | null;
  unreadable: boolean;
}) {
  const gt = useGT();
  const { shell } = props;
  const providers = useEnvironmentProviders();
  const settings = useAtomValue(
    shell ? serverEnvironment.settingsValueAtom(shell.environmentId) : noThreadChipServerSettingsAtom,
  );
  const supportsMultiplePullRequests = useSupportsMultiplePullRequests(
    shell?.environmentId ?? null,
  );
  const instanceId = shell
    ? (shell.runtime?.providerInstanceId ?? shell.modelSelection.instanceId)
    : null;
  const envProviders = shell ? (providers.get(shell.environmentId) ?? []) : [];
  const providerEntries = settings
    ? providerInstanceEntriesFor(envProviders, settings, shell?.projectId ?? null)
    : disambiguateProviderInstanceDisplayNames(deriveProviderInstanceEntries(envProviders));
  const providerEntry = instanceId
    ? (providerEntries.find((entry) => entry.instanceId === instanceId) ?? null)
    : null;
  const provider =
    shell && instanceId
      ? (envProviders.find((entry) => entry.instanceId === instanceId) ?? null)
      : null;
  const model = shell
    ? provider?.models.find((entry) => entry.slug === shell.modelSelection.model)
    : undefined;
  const modelLabel = model
    ? getTriggerDisplayModelName(model, provider?.driver)
    : shell?.modelSelection.model.trim();
  const providerDisplayName = providerEntry
    ? resolveProviderEntryDisplayName(providerEntry)
    : provider
      ? resolveProviderInstanceDisplayName(provider)
      : "";
  return (
    <ThreadHoverCard
      title={props.title}
      footer={
        supportsMultiplePullRequests && shell && shell.pullRequests.length > 0 ? (
          <div className="border-t border-border/60 pt-2 pl-0.5 text-xs text-muted-foreground">
            <ThreadPullRequestsMiniList pullRequests={shell.pullRequests} />
          </div>
        ) : null
      }
    >
      {props.project ? (
        <div className="flex min-w-0 items-center gap-2">
          <ProjectFavicon project={props.project} className="size-3 shrink-0" />
          <div className="min-w-0 truncate text-foreground/75">{props.project.title}</div>
        </div>
      ) : null}
      {shell?.branch ? (
        <div className="flex min-w-0 items-center gap-2">
          <GitBranchIcon className="size-3 shrink-0 stroke-muted-foreground" />
          <MiddleTruncate value={shell.branch} className="flex" />
        </div>
      ) : null}
      {provider && modelLabel ? (
        <div className="flex min-w-0 items-center gap-2">
          <ProviderInstanceIcon
            driverKind={providerEntry?.driverKind ?? provider.driver}
            displayName={providerDisplayName}
            instanceId={providerEntry?.instanceId ?? provider.instanceId}
            accentColor={providerEntry?.accentColor}
            acpRegistryAgentId={providerEntry?.acpRegistryAgentId}
            acpRegistryIconUrl={providerEntry?.acpRegistryIconUrl ?? provider.iconUrl}
            iconClassName="size-3 shrink-0 opacity-60"
          />
          <div className="min-w-0 truncate text-foreground/75">{modelLabel}</div>
        </div>
      ) : null}
      {props.unreadable ? (
        <div className="flex min-w-0 items-start gap-2 text-warning">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3 shrink-0 stroke-current" />
          <div className="min-w-0 flex-1 wrap-break-word">
            {gt(
              "On another machine, so this machine's agent can't read it. Remove it or switch back to send.",
            )}
          </div>
        </div>
      ) : null}
    </ThreadHoverCard>
  );
}
