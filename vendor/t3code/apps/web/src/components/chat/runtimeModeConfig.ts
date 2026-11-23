import { managedRuntimeModeDenial } from "@t3tools/client-runtime/contract-labels";
import type { ManagedPolicySummary, RuntimeMode } from "@t3tools/contracts";
import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";
import {
  type LucideIcon,
  FilePenLineIcon,
  HandIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: msg("Ask for approval"),
    description: msg("Asks before edits and commands your settings don't allow"),
    icon: HandIcon,
  },
  "auto-accept-edits": {
    label: msg("Accept edits"),
    description: msg("Approves file edits and file commands; asks for the rest"),
    icon: FilePenLineIcon,
  },
  auto: {
    label: msg("Approve for me"),
    description: msg("Reviews approval requests for you"),
    icon: ShieldCheckIcon,
  },
  "full-access": {
    label: msg("Full access"),
    description: msg("Never asks before edits or commands"),
    icon: ShieldAlertIcon,
  },
};

export function isFullAccessRuntimeMode(mode: RuntimeMode): boolean {
  return mode === "full-access";
}

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

/** The modes a provider supports (all when it reports none) and the mode a thread really runs in. */
export function resolveCompatibleRuntimeMode(
  runtimeMode: RuntimeMode,
  supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined,
) {
  const modes =
    supportedRuntimeModes && supportedRuntimeModes.length > 0
      ? runtimeModeOptions.filter((mode) => supportedRuntimeModes.includes(mode))
      : runtimeModeOptions;
  return { modes, mode: modes.includes(runtimeMode) ? runtimeMode : (modes[0] ?? runtimeMode) };
}

export function resolveRuntimeModeOption(
  mode: RuntimeMode,
  resolve: MessageResolver = m,
): {
  mode: RuntimeMode;
  label: string;
  description: string;
  icon: LucideIcon;
  disabledReason?: string;
} {
  const config = runtimeModeConfig[mode];
  return {
    mode,
    ...config,
    label: resolve(config.label),
    description: resolve(config.description),
  };
}

/** Why `mode` is unavailable under `managedPolicy`, or undefined when it is allowed. */
export function runtimeModeDenial(
  managedPolicy: ManagedPolicySummary | undefined,
  mode: RuntimeMode,
  resolve: MessageResolver = m,
) {
  const ceiling = managedPolicy?.limits?.maxRuntimeMode;
  if (ceiling === undefined || managedRuntimeModeDenial(managedPolicy, mode) === undefined) {
    return undefined;
  }
  return resolve(
    msg("{organization} limits threads to {mode}.", {
      organization: managedPolicy!.organization,
      mode: resolve(runtimeModeConfig[ceiling].label),
    }),
  );
}

export function resolveRuntimeModeOptions(
  modes: ReadonlyArray<RuntimeMode>,
  managedPolicy: ManagedPolicySummary | undefined,
  resolve: MessageResolver = m,
) {
  return modes.map((mode) => {
    const option = resolveRuntimeModeOption(mode, resolve);
    const disabledReason = runtimeModeDenial(managedPolicy, mode, resolve);
    return disabledReason === undefined ? option : { ...option, disabledReason };
  });
}
