import { type CSSProperties, memo } from "react";

import {
  normalizeProviderAccentColor,
  providerAccentForegroundColor,
  providerInstanceInitials,
} from "@prismux/client-runtime/state/provider-instance-display";

import { ProviderDriverKind } from "@prismux/core-contracts";
import {
  AnthropicIcon,
  AntigravityIcon,
  ClaudeAI,
  Icon,
  OllamaIcon,
  OpenAI,
  OpenRouterIcon,
} from "../Icons";

import { cn } from "~/lib/utils";
import {
  agentBrandIdToAcpBrandKey,
  DSH_BRAND_COLOR,
  DSH_FISH_LOGO_PATH,
  DSH_FISH_LOGO_VIEWBOX,
  inferAgentBrandFromModel,
  resolveAcpAgentBrandKey,
  resolveAgentBrandId,
} from "../../prismux/agentBrand";
import { providerClients } from "../settings/providerDriverMeta";
import { ProviderPackageIcon } from "./ProviderPackageIcon";
import {
  AcpRegistryAgentIcon,
  BundledAcpBrandIcon,
  officialAcpRegistryIconUrlForAgentId,
  resolveOfficialAcpRegistryIconUrl,
} from "../settings/AcpRegistryIcon";

const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderDriverKind, Icon>> = {
  [ProviderDriverKind.make("codex")]: OpenAI,
  [ProviderDriverKind.make("claudeAgent")]: ClaudeAI,
  [ProviderDriverKind.make("antigravity")]: AntigravityIcon,
  // Text generators, by the service they reach (see textGeneratorBrand).
  [ProviderDriverKind.make("openai")]: OpenAI,
  [ProviderDriverKind.make("anthropic")]: AnthropicIcon,
  [ProviderDriverKind.make("openrouter")]: OpenRouterIcon,
  [ProviderDriverKind.make("ollama")]: OllamaIcon,
};

const PROVIDER_TEXT_COLOR_BY_PROVIDER: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("codex")]: "text-black dark:text-white",
  [ProviderDriverKind.make("claudeAgent")]: "text-[#d97757]",
  [ProviderDriverKind.make("antigravity")]: "text-[#4285F4]",
  [ProviderDriverKind.make("dsh")]: "text-[#4176E6]",
  [ProviderDriverKind.make("openai")]: "text-black dark:text-white",
  [ProviderDriverKind.make("anthropic")]: "text-black dark:text-white",
  [ProviderDriverKind.make("openrouter")]: "text-black dark:text-white",
  [ProviderDriverKind.make("ollama")]: "text-black dark:text-white",
};

const BUNDLED_LOGO_COLOR_BY_PROVIDER: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("claudeAgent")]: "#d97757",
  [ProviderDriverKind.make("antigravity")]: "#4285F4",
  [ProviderDriverKind.make("dsh")]: DSH_BRAND_COLOR,
};

export function isDshProviderInstance(input: {
  readonly driverKind: string;
  readonly displayName?: string | null | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly instanceId?: string | undefined;
  readonly commandPath?: string | null | undefined;
}): boolean {
  return (
    resolveAgentBrandId(input.driverKind) === "dsh" ||
    resolveAcpAgentBrandKey({
      agentId: input.acpRegistryAgentId,
      instanceId: input.instanceId,
      displayName: input.displayName,
      commandPath: input.commandPath,
    }) === "dsh"
  );
}

function DshFishIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox={DSH_FISH_LOGO_VIEWBOX}
      fill={DSH_BRAND_COLOR}
      className={className}
      data-dsh-brand-icon="true"
      aria-hidden="true"
      focusable="false"
    >
      <path d={DSH_FISH_LOGO_PATH} />
    </svg>
  );
}

/** The logo's own color, or null for logos that swap between black and white per theme. */
export function providerLogoColor(driverKind: ProviderDriverKind): string | null {
  const fill = providerClients.get(driverKind)?.icon?.fill;
  if (fill) return fill.light === fill.dark ? fill.light : null;
  return BUNDLED_LOGO_COLOR_BY_PROVIDER[driverKind] ?? null;
}

export function providerTextColor(driverKind: ProviderDriverKind): {
  readonly className?: string;
  readonly style?: CSSProperties;
} {
  const icon = providerClients.get(driverKind)?.icon;
  if (icon) {
    return {
      className: "text-(--icon-light) dark:text-(--icon-dark)",
      style: { "--icon-light": icon.fill.light, "--icon-dark": icon.fill.dark } as CSSProperties,
    };
  }
  const className = PROVIDER_TEXT_COLOR_BY_PROVIDER[driverKind];
  return className ? { className } : {};
}

export function resolveProviderInstanceAcpRegistryIconUrl(input: {
  readonly driverKind: ProviderDriverKind;
  readonly agentId?: string | undefined;
  readonly iconUrl?: string | undefined;
}): string | null {
  if (input.driverKind !== "acpRegistry") return null;
  return (
    resolveOfficialAcpRegistryIconUrl(input.iconUrl ?? null) ??
    officialAcpRegistryIconUrlForAgentId(input.agentId?.trim() || null)
  );
}

export const ProviderInstanceIcon = memo(function ProviderInstanceIcon(props: {
  driverKind: ProviderDriverKind;
  displayName: string;
  instanceId?: string | undefined;
  accentColor?: string | undefined;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  acpCommandPath?: string | undefined;
  model?: string | null | undefined;
  showBadge?: boolean;
  badgeContent?: "initials" | "none";
  size?: "default" | "compact";
  className?: string;
  iconClassName?: string;
  badgeClassName?: string;
  indicatorBackground?: string;
}) {
  const Icon = PROVIDER_ICON_BY_PROVIDER[props.driverKind] ?? null;
  const packageIcon = providerClients.get(props.driverKind)?.icon;
  const indicatorBackground = props.indicatorBackground ?? "var(--card)";
  const accentColor = normalizeProviderAccentColor(props.accentColor);
  const accentStyle = accentColor
    ? ({
        "--provider-accent": accentColor,
        "--provider-accent-foreground": providerAccentForegroundColor(accentColor),
      } as CSSProperties)
    : undefined;
  const badgeContent = props.badgeContent ?? "initials";
  const iconClassName = cn(props.size === "compact" && "size-3.5", props.iconClassName);
  const isDshInstance = isDshProviderInstance({
    driverKind: props.driverKind,
    displayName: props.displayName,
    acpRegistryAgentId: props.acpRegistryAgentId,
    instanceId: props.instanceId,
    commandPath: props.acpCommandPath,
  });
  const isAcpRegistry = props.driverKind === "acpRegistry";
  const acpBrandKey = isAcpRegistry
    ? resolveAcpAgentBrandKey({
        agentId: props.acpRegistryAgentId,
        instanceId: props.instanceId,
        displayName: props.displayName,
        commandPath: props.acpCommandPath,
      })
    : null;
  // A custom OpenAI-compatible endpoint has no brand: show its name, marked with the protocol.
  const isCustomEndpoint = props.driverKind === "openaiCompatible";
  const acpRegistryIconUrl = resolveProviderInstanceAcpRegistryIconUrl({
    driverKind: props.driverKind,
    agentId: props.acpRegistryAgentId,
    iconUrl: props.acpRegistryIconUrl,
  });
  const fallbackBundledBrandKey =
    !isDshInstance && !isAcpRegistry && !isCustomEndpoint && !packageIcon && !Icon
      ? resolveAcpAgentBrandKey({
          agentId: props.acpRegistryAgentId || props.driverKind,
          instanceId: props.instanceId,
          displayName: props.displayName,
          commandPath: props.acpCommandPath,
        })
      : null;
  const isGenericOrUnresolved =
    (isAcpRegistry && acpBrandKey === null && acpRegistryIconUrl === null) ||
    (!isAcpRegistry &&
      !isCustomEndpoint &&
      !packageIcon &&
      !Icon &&
      fallbackBundledBrandKey === null);
  const inferredModelBrandKey =
    !isDshInstance && isGenericOrUnresolved
      ? agentBrandIdToAcpBrandKey(inferAgentBrandFromModel(props.model))
      : null;
  const renderDshIcon = isDshInstance || inferredModelBrandKey === "dsh";
  const renderAntigravityIcon =
    (isAcpRegistry && acpBrandKey === "antigravity") ||
    fallbackBundledBrandKey === "antigravity" ||
    inferredModelBrandKey === "antigravity";

  return (
    <span
      className={cn(
        "relative isolate z-30 inline-flex shrink-0 items-center justify-center overflow-visible",
        props.className,
      )}
      style={accentStyle}
      data-provider-accent-color={accentColor}
    >
      {renderDshIcon ? (
        <DshFishIcon className={cn("size-5 shrink-0", iconClassName)} />
      ) : renderAntigravityIcon ? (
        <AntigravityIcon className={cn("size-5 shrink-0", iconClassName)} aria-hidden />
      ) : inferredModelBrandKey !== null ? (
        <BundledAcpBrandIcon
          brandKey={inferredModelBrandKey}
          className={cn("size-5 shrink-0", iconClassName)}
        />
      ) : isAcpRegistry ? (
        <AcpRegistryAgentIcon
          className={cn("size-5 rounded-none bg-transparent text-foreground", iconClassName)}
          fallbackClassName="size-full"
          icon={acpRegistryIconUrl}
          agentId={props.acpRegistryAgentId}
          instanceId={props.instanceId}
          displayName={props.displayName}
          commandPath={props.acpCommandPath}
        />
      ) : isCustomEndpoint ? (
        // The tile is a size container: below ~18px it keeps one letter and drops the mark.
        <span
          className={cn(
            "@container relative flex size-5 shrink-0 items-center justify-center rounded-md border bg-card text-4xs font-semibold leading-none text-foreground",
            iconClassName,
          )}
          aria-hidden
        >
          {Array.from(providerInstanceInitials(props.displayName))[0]}
          <span className="@max-[1.1rem]:hidden">
            {Array.from(providerInstanceInitials(props.displayName)).slice(1).join("")}
          </span>
          <span
            className={cn(
              "pointer-events-none absolute right-[-0.3125rem] bottom-[-0.3125rem] z-10 flex size-3 items-center justify-center rounded-full border bg-card text-foreground shadow-sm @max-[1.1rem]:hidden",
              props.badgeClassName,
            )}
            style={{ borderColor: indicatorBackground }}
          >
            <OpenAI className="size-2" />
          </span>
        </span>
      ) : packageIcon ? (
        <ProviderPackageIcon
          icon={packageIcon}
          className={cn("size-5 shrink-0", iconClassName)}
          aria-hidden
        />
      ) : Icon ? (
        <Icon className={cn("size-5 shrink-0", iconClassName)} aria-hidden />
      ) : fallbackBundledBrandKey ? (
        <BundledAcpBrandIcon
          brandKey={fallbackBundledBrandKey}
          className={cn("size-5 shrink-0", iconClassName)}
        />
      ) : (
        <span className={cn("text-3xs font-semibold leading-none", iconClassName)}>
          {providerInstanceInitials(props.displayName)}
        </span>
      )}
      {isCustomEndpoint || renderDshIcon ? null : props.showBadge ? (
        <span
          className={cn(
            "pointer-events-none absolute right-0 bottom-0 z-10 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border px-0.5 text-4xs font-semibold leading-none shadow-sm",
            accentColor
              ? "bg-(--provider-accent) text-(--provider-accent-foreground)"
              : "bg-card text-muted-foreground",
            props.size === "compact" &&
              "right-[-0.1875rem] bottom-[-0.1875rem] h-3 min-w-3 px-0.5 text-5xs",
            props.badgeClassName,
          )}
          style={{ borderColor: indicatorBackground }}
          aria-hidden
        >
          {badgeContent === "initials" ? providerInstanceInitials(props.displayName) : null}
        </span>
      ) : null}
    </span>
  );
});
