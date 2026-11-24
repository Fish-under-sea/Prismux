import { useAuth, useClerk } from "@clerk/react";
import { useAtomValue } from "@effect/atom-react";
import { managedCapabilityDenial } from "@t3tools/client-runtime/contract-labels";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  AuthRelayReadScope,
  AuthRelayWriteScope,
  type EnvironmentId,
  connectReachabilityHelpUrl,
  formatConnectReachable,
} from "@t3tools/contracts";
import {
  AlertCircleIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CloudIcon,
  CopyIcon,
  ExternalLinkIcon,
  LogInIcon,
  LogOutIcon,
  RefreshCwIcon,
  ServerIcon,
  UserIcon,
} from "lucide-react";
import { msg, useGT, useMessages } from "gt-react";
import { useEffect, useEffectEvent, useState, useSyncExternalStore } from "react";

import { useManagedTunnelUsage } from "../../cloud/managedRelayState";
import { resolveCloudPublicConfig, setT3ConnectOptIn } from "../../cloud/publicConfig";
import { useCloudLinkController } from "../../cloud/useCloudLinkController";
import { useT3ConnectTurnOn } from "../../cloud/useT3ConnectTurnOn";
import { isElectron } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { cn } from "../../lib/utils";
import { useManagedPolicy } from "../../state/managedPolicy";
import { relayEnvironmentDiscovery } from "../../state/relay";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { retryClerkLoad, useClerkLoadFailed } from "../clerk/clerkLoadFailure";
import {
  type T3ConnectAccountPageUrl,
  useT3ConnectAccountPage,
} from "../clerk/T3ConnectAccountPages";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { QRCodeSvg } from "../ui/qr-code";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TunnelLimitAlert, TunnelUsageMeter } from "./TunnelUsage";
import {
  type ClerkUserLike,
  type T3ConnectAvailability,
  type T3ConnectRelayStatusKind,
  formatT3CodeAccountIdentity,
  getPrismuxRemoteConnectCopy,
  resolveT3ConnectAvailability,
  resolveT3ConnectRemoteAccess,
} from "./prismuxRemoteConnect.logic";

export interface T3ConnectAccountCardProps {
  readonly environmentId: EnvironmentId | null;
  readonly canReadRelay?: boolean;
  readonly canManageRelay?: boolean;
  readonly variant?: "settings" | "dialog";
  readonly className?: string;
}

function useRemoteConnectCopy() {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot, getI18nSnapshot);
  return getPrismuxRemoteConnectCopy(locale);
}

function relayStatusBadgeMeta(
  status: T3ConnectRelayStatusKind,
  copy: ReturnType<typeof getPrismuxRemoteConnectCopy>,
): { readonly label: string; readonly variant: "success" | "warning" | "error" | "outline" } {
  switch (status) {
    case "online":
      return { label: copy.t3ConnectStatusOnline, variant: "success" };
    case "checking":
      return { label: copy.t3ConnectStatusChecking, variant: "warning" };
    case "unreachable":
      return { label: copy.t3ConnectStatusUnreachable, variant: "error" };
    case "revoked":
      return { label: copy.t3ConnectStatusRevoked, variant: "warning" };
    case "inactive":
    default:
      return { label: copy.t3ConnectStatusInactive, variant: "outline" };
  }
}

function UnavailableT3ConnectAccountCard({
  availability,
  variant = "settings",
  className,
}: {
  readonly availability: Exclude<T3ConnectAvailability, { readonly kind: "ready" }>;
  readonly variant?: "settings" | "dialog";
  readonly className?: string | undefined;
}) {
  const copy = useRemoteConnectCopy();
  const isOptInRequired = availability.kind === "opt-in-required";
  const isDesktopOrHosted = availability.kind === "desktop-or-hosted-required";

  const handleEnableCloudRelay = () => {
    setT3ConnectOptIn(true);
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <div
      data-testid="t3-connect-account-card"
      data-t3-connect-state={availability.kind}
      className={cn(
        "rounded-lg border border-border/75 bg-muted/25 p-3.5 text-left",
        "[[data-pmx-glass='1']_&]:border-border/60 [[data-pmx-glass='1']_&]:bg-background/45",
        variant === "settings" && "mx-3 my-3 sm:mx-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/12 text-primary">
            <CloudIcon aria-hidden className="size-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{copy.t3ConnectTitle}</h3>
              <Badge variant="outline" size="sm">
                {isOptInRequired ? copy.t3ConnectOptInBadge : "T3 Connect"}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isOptInRequired
                ? copy.t3ConnectOptInDesc
                : isDesktopOrHosted
                  ? copy.t3ConnectDesktopRequiredDesc
                  : copy.t3ConnectUnconfiguredDesc}
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11px] text-muted-foreground">
              {availability.relayUrl ? (
                <span className="inline-flex items-center gap-1 font-mono">
                  <ServerIcon aria-hidden className="size-3" />
                  {copy.t3ConnectRelayServerLabel}: {availability.relayUrl}
                </span>
              ) : null}
              <span className="font-mono">{copy.t3ConnectHostCommandHint}</span>
            </div>
          </div>
        </div>
        {isOptInRequired ? (
          <Button
            type="button"
            size="sm"
            variant="default"
            data-testid="t3-connect-enable-opt-in-button"
            className="shrink-0"
            onClick={handleEnableCloudRelay}
          >
            <LogInIcon aria-hidden className="size-3.5" />
            <span>{copy.t3ConnectOptInEnableButton}</span>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            render={
              <a href={availability.hostedAppUrl} target="_blank" rel="noreferrer noopener" />
            }
          >
            <span>{copy.t3ConnectOpenHosted}</span>
            <ExternalLinkIcon aria-hidden className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ConfiguredT3ConnectAccountCard({
  environmentId,
  canReadRelayProp,
  canManageRelayProp,
  variant = "settings",
  className,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly canReadRelayProp?: boolean | undefined;
  readonly canManageRelayProp?: boolean | undefined;
  readonly variant?: "settings" | "dialog";
  readonly className?: string | undefined;
}) {
  const copy = useRemoteConnectCopy();
  const gt = useGT();
  const m = useMessages();
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const clerkLoadFailed = useClerkLoadFailed();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const accountPage = useT3ConnectAccountPage();
  const scopeCanReadRelay = useEnvironmentScope(environmentId, AuthRelayReadScope);
  const scopeCanWriteRelay = useEnvironmentScope(environmentId, AuthRelayWriteScope);
  const canReadRelay = canReadRelayProp ?? scopeCanReadRelay;
  const canManageRelay = canManageRelayProp ?? scopeCanWriteRelay;

  const {
    linkState: cloudLinkState,
    linkRevoked,
    managedTunnelActive,
    managedTunnelOutOfSync,
    publishAgentActivity,
    operationError,
    tunnelLimit,
    needsRelayConfiguration,
    reconcileCloudState,
  } = useCloudLinkController(environmentId);
  const turnOn = useT3ConnectTurnOn(environmentId);
  const connectDenial = managedCapabilityDenial(useManagedPolicy(environmentId), "connect", m);
  const relayEnvironments = useAtomValue(relayEnvironmentDiscovery.stateValueAtom).environments;
  const relayEndpoint = environmentId
    ? relayEnvironments.get(environmentId)?.environment.endpoint
    : undefined;
  const usage = useManagedTunnelUsage();

  const [isOpeningAuth, setIsOpeningAuth] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isTogglingTunnel, setIsTogglingTunnel] = useState(false);

  const refreshLinkState = useEffectEvent(cloudLinkState.refresh);
  // Keep reachability up to date while mounted on Settings or inside the modal.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls server cloud link reachability while visible
  useEffect(() => {
    const interval = window.setInterval(() => refreshLinkState(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const { copyToClipboard: copyRemoteUrl, isCopied: isRemoteUrlCopied } = useCopyToClipboard({
    target: {
      target: "T3 Connect URL",
      unavailableMessage: msg("Clipboard API is unavailable while copying URL."),
      failureMessage: msg("Failed to copy T3 Connect URL to the clipboard."),
    },
    timeout: 1_500,
  });
  const { copyToClipboard: copyTunnelUrl, isCopied: isTunnelUrlCopied } = useCopyToClipboard({
    target: {
      target: "T3 Connect tunnel URL",
      unavailableMessage: msg("Clipboard API is unavailable while copying URL."),
      failureMessage: msg("Failed to copy T3 Connect tunnel URL to the clipboard."),
    },
    timeout: 1_500,
  });

  const publicConfig = resolveCloudPublicConfig();
  const remoteAccess = resolveT3ConnectRemoteAccess({
    managedTunnelActive,
    linkRevoked,
    linkState: cloudLinkState.data,
    relayEndpoint,
    configuredRelayUrl: publicConfig.relayUrl,
  });
  const statusBadge = relayStatusBadgeMeta(remoteAccess.status, copy);
  const accountIdentity = formatT3CodeAccountIdentity(
    (clerk.user as ClerkUserLike | null | undefined) ?? null,
  );
  const showSwitch = environmentId !== null && (turnOn.kind !== "on-host" || managedTunnelActive);
  const tunnelNeedsConfigure = needsRelayConfiguration({
    managedTunnel: !managedTunnelActive,
    publish: publishAgentActivity,
  });
  const disabledReason = !canManageRelay
    ? gt("Your session does not have permission to manage T3 Connect access.")
    : tunnelNeedsConfigure
      ? gt("This connection needs the relay configuration permission to configure T3 Connect.")
      : connectDenial ?? null;
  const switchDisabled =
    !isSignedIn ||
    !canReadRelay ||
    !canManageRelay ||
    tunnelNeedsConfigure ||
    cloudLinkState.data === null ||
    cloudLinkState.isPending ||
    isTogglingTunnel ||
    (!managedTunnelActive && connectDenial !== undefined);

  const handleOpenSignIn = () => {
    setIsOpeningAuth(true);
    try {
      openAuthPrompt();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: copy.t3ConnectSignInFailedTitle,
          description:
            error instanceof Error
              ? (thrownErrorMessage(error, m) ?? error.message)
              : String(error),
        }),
      );
    } finally {
      window.setTimeout(() => setIsOpeningAuth(false), 600);
    }
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await clerk.signOut();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: copy.t3ConnectSignOutFailedTitle,
          description:
            error instanceof Error
              ? (thrownErrorMessage(error, m) ?? error.message)
              : String(error),
        }),
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleToggleManagedTunnel = async (enabled: boolean) => {
    if (environmentId === null || !readEnvironmentScope(environmentId, AuthRelayWriteScope)) return;
    setIsTogglingTunnel(true);
    const ok = await reconcileCloudState({
      managedTunnel: enabled,
      publish: publishAgentActivity,
    });
    if (ok) {
      toastManager.add({
        type: "success",
        title: enabled
          ? gt("T3 Connect linked")
          : publishAgentActivity
            ? gt("T3 Connect tunnel disabled")
            : gt("T3 Connect unlinked"),
        description: enabled
          ? gt("This environment is available through T3 Connect.")
          : publishAgentActivity
            ? gt("The managed tunnel was removed. Agent activity publishing stays on.")
            : gt("This environment is no longer available through T3 Connect."),
      });
    }
    setIsTogglingTunnel(false);
  };

  const openAccountPage = (page: T3ConnectAccountPageUrl) => {
    accountPage.open?.(page);
  };

  const reachability = managedTunnelActive ? cloudLinkState.data?.reachability : undefined;
  const reachabilityNode =
    reachability?.status === "reachable" ? (
      <span className="text-xs text-emerald-600 dark:text-emerald-400">
        {formatConnectReachable(reachability)}
      </span>
    ) : reachability?.status === "unreachable" ? (
      <span className="block text-xs text-destructive">
        {[reachability.reason, reachability.hint, gt("Fix: {fix}", { fix: reachability.fix })]
          .filter(Boolean)
          .join(" ")}{" "}
        <a
          href={connectReachabilityHelpUrl(reachability.cause)}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {gt("More info")}
        </a>
      </span>
    ) : null;

  return (
    <div
      data-testid="t3-connect-account-card"
      data-t3-connect-state={
        clerkLoadFailed
          ? "load-error"
          : !isLoaded
            ? "loading"
            : isSignedIn
              ? "signed-in"
              : "signed-out"
      }
      className={cn(
        "space-y-3 rounded-lg border border-border/75 bg-muted/25 p-3.5 text-left",
        "[[data-pmx-glass='1']_&]:border-border/60 [[data-pmx-glass='1']_&]:bg-background/45",
        variant === "settings" && "mx-3 my-3 sm:mx-4",
        className,
      )}
    >
      {/* Account header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {isLoaded && isSignedIn ? (
            accountIdentity.imageUrl ? (
              <img
                src={accountIdentity.imageUrl}
                alt={accountIdentity.displayName}
                className="size-9 shrink-0 rounded-full border border-border/70 object-cover"
              />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/35 bg-primary/15 text-xs font-semibold text-primary">
                {accountIdentity.initials}
              </span>
            )
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/12 text-primary">
              <CloudIcon aria-hidden className="size-4.5" />
            </span>
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground">
                {isLoaded && isSignedIn ? accountIdentity.displayName : copy.t3ConnectTitle}
              </h3>
              {isLoaded && isSignedIn ? (
                <Badge
                  data-testid="t3-connect-relay-status-badge"
                  data-relay-status={remoteAccess.status}
                  variant={statusBadge.variant}
                  size="sm"
                >
                  {statusBadge.label}
                </Badge>
              ) : (
                <Badge variant="outline" size="sm">
                  T3 Connect
                </Badge>
              )}
            </div>
            {clerkLoadFailed ? (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircleIcon aria-hidden className="size-3.5 shrink-0" />
                <span>{copy.t3ConnectAuthLoadFailed}</span>
              </p>
            ) : !isLoaded ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Spinner size="xs" />
                <span>{copy.t3ConnectLoadingAuth}</span>
              </p>
            ) : isSignedIn ? (
              <p className="truncate text-xs text-muted-foreground">
                {accountIdentity.email ??
                  (remoteAccess.relayUrl
                    ? `${copy.t3ConnectRelayServerLabel}: ${remoteAccess.relayUrl}`
                    : "T3 Connect")}
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {copy.t3ConnectSignedOutDesc}
              </p>
            )}
          </div>
        </div>

        {/* Account actions */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {clerkLoadFailed ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="t3-connect-retry-auth-button"
              onClick={retryClerkLoad}
            >
              <RefreshCwIcon aria-hidden className="size-3.5" />
              <span>{copy.t3ConnectRetryAuth}</span>
            </Button>
          ) : !isLoaded ? null : isSignedIn ? (
            <>
              {accountPage.open ? (
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  data-testid="t3-connect-manage-account-button"
                  onClick={() => openAccountPage("t3-connect")}
                >
                  <UserIcon aria-hidden className="size-3" />
                  <span>{copy.t3ConnectManageAccount}</span>
                </Button>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant="outline"
                data-testid="t3-connect-sign-out-button"
                disabled={isSigningOut}
                onClick={() => void handleSignOut()}
              >
                {isSigningOut ? <Spinner size="xs" /> : <LogOutIcon aria-hidden className="size-3" />}
                <span>{isSigningOut ? copy.t3ConnectSigningOut : copy.t3ConnectSignOutButton}</span>
              </Button>
            </>
          ) : (
            <>
              {isElectron ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  data-testid="t3-connect-disable-opt-in-button"
                  onClick={() => {
                    setT3ConnectOptIn(false);
                    if (typeof window !== "undefined") {
                      window.location.reload();
                    }
                  }}
                >
                  <span>{copy.t3ConnectOptInDisableButton}</span>
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="default"
                data-testid="t3-connect-sign-in-button"
                disabled={isOpeningAuth}
                onClick={handleOpenSignIn}
              >
                {isOpeningAuth ? <Spinner size="xs" /> : <LogInIcon aria-hidden className="size-3.5" />}
                <span>{isOpeningAuth ? copy.t3ConnectSigningIn : copy.t3ConnectSignInButton}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Signed-in relay toggle, diagnostics, usage meter, and scannable remote URL + QR */}
      {isLoaded && isSignedIn ? (
        <div className="space-y-3 border-t border-border/60 pt-3">
          {showSwitch ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-xs font-medium text-foreground">{copy.t3ConnectToggleTitle}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {managedTunnelOutOfSync
                    ? gt(
                        "T3 Connect is out of sync. Turn T3 Connect on to repair the remote tunnel.",
                      )
                    : copy.t3ConnectToggleDesc}
                </p>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex shrink-0 items-center gap-2">
                      {isTogglingTunnel ? <Spinner size="xs" /> : null}
                      <Switch
                        data-testid="t3-connect-remote-switch"
                        aria-label={copy.t3ConnectToggleTitle}
                        checked={managedTunnelActive}
                        disabled={switchDisabled}
                        onCheckedChange={(checked) => void handleToggleManagedTunnel(checked)}
                      />
                    </span>
                  }
                />
                {disabledReason ? <TooltipPopup side="top">{disabledReason}</TooltipPopup> : null}
              </Tooltip>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {linkRevoked
                ? gt(
                    "This environment was removed from T3 Connect. Run `t3 connect link` on the host to link it again.",
                  )
                : gt("Run `t3 connect link` on the host, then restart Prismux there.")}
            </p>
          )}

          {operationError ? (
            <p className="text-xs text-destructive" role="alert">
              {operationError}
            </p>
          ) : cloudLinkState.error ? (
            <p className="text-xs text-destructive" role="alert">
              {cloudLinkState.error}
            </p>
          ) : (
            reachabilityNode
          )}

          {tunnelLimit !== null ? (
            <TunnelLimitAlert
              upgrade={usage.upgrade}
              onLinkT3Chat={accountPage.open ? () => openAccountPage("t3-chat") : null}
              onManageTunnels={accountPage.open ? () => openAccountPage("t3-connect") : null}
            />
          ) : usage.used !== null && usage.limit !== null ? (
            <TunnelUsageMeter used={usage.used} limit={usage.limit} />
          ) : null}

          {managedTunnelActive ? (
            <div
              data-testid="t3-connect-remote-qr"
              className="flex flex-col gap-3 rounded-lg border border-border/70 bg-background/65 p-3 sm:flex-row sm:items-center"
            >
              <div className="mx-auto shrink-0 rounded-lg border border-black/10 bg-white p-2 shadow-xs sm:mx-0">
                <QRCodeSvg
                  value={remoteAccess.qrUrl}
                  size={128}
                  level="M"
                  marginSize={1}
                  title={copy.t3ConnectRemoteUrlLabel}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {copy.t3ConnectScanHint}
                </p>
                <div className="space-y-1">
                  <span className="block text-[11px] font-medium text-muted-foreground">
                    {copy.t3ConnectRemoteUrlLabel}
                  </span>
                  <div className="flex items-center gap-1.5 rounded-md border border-border/75 bg-muted/45 px-2 py-1">
                    <code
                      data-testid="t3-connect-remote-url"
                      className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground"
                    >
                      {remoteAccess.remoteWebUrl}
                    </code>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost-muted"
                      data-testid="t3-connect-copy-url-button"
                      aria-label={isRemoteUrlCopied ? copy.copied : copy.copyLink}
                      onClick={() => copyRemoteUrl(remoteAccess.remoteWebUrl)}
                    >
                      {isRemoteUrlCopied ? (
                        <CheckIcon className="size-3 text-emerald-500" />
                      ) : (
                        <CopyIcon className="size-3" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={copy.t3ConnectOpenHosted}
                      render={
                        <a
                          href={remoteAccess.remoteWebUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        />
                      }
                    >
                      <ArrowUpRightIcon className="size-3" />
                    </Button>
                  </div>
                </div>
                {remoteAccess.tunnelOriginUrl ? (
                  <div className="space-y-1">
                    <span className="block text-[11px] font-medium text-muted-foreground">
                      {copy.t3ConnectTunnelOriginLabel}
                    </span>
                    <div className="flex items-center gap-1.5 rounded-md border border-border/65 bg-muted/35 px-2 py-1">
                      <code
                        data-testid="t3-connect-tunnel-url"
                        className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90"
                      >
                        {remoteAccess.tunnelOriginUrl}
                      </code>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={isTunnelUrlCopied ? copy.copied : copy.copyLink}
                        onClick={() => copyTunnelUrl(remoteAccess.tunnelOriginUrl!)}
                      >
                        {isTunnelUrlCopied ? (
                          <CheckIcon className="size-3 text-emerald-500" />
                        ) : (
                          <CopyIcon className="size-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {accountPage.portals}
    </div>
  );
}

/**
 * Shared T3 Code Account & T3 Connect Relay remote-control card used across
 * `/settings/access` ("Sharing & access") and the centered `PrismuxRemoteConnectDialog`.
 */
export function T3ConnectAccountCard({
  environmentId,
  canReadRelay,
  canManageRelay,
  variant = "settings",
  className,
}: T3ConnectAccountCardProps) {
  const availability = resolveT3ConnectAvailability();

  if (availability.kind !== "ready") {
    return (
      <UnavailableT3ConnectAccountCard
        availability={availability}
        variant={variant}
        className={className}
      />
    );
  }

  return (
    <ConfiguredT3ConnectAccountCard
      environmentId={environmentId}
      canReadRelayProp={canReadRelay}
      canManageRelayProp={canManageRelay}
      variant={variant}
      className={className}
    />
  );
}
