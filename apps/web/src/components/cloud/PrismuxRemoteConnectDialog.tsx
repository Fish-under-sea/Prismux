import { thrownErrorMessage } from "@prismux/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@prismux/client-runtime/state/runtime";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthStandardClientScopes,
  type AdvertisedEndpoint,
  type AuthGrantScope,
} from "@prismux/core-contracts";
import { useNavigate } from "@tanstack/react-router";
import { msg, useMessages } from "gt-react";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  QrCodeIcon,
  Settings2Icon,
  WifiOffIcon,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { isElectron } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { getI18nSnapshot, subscribeI18n } from "../../i18n/runtime";
import { authEnvironment } from "../../state/auth";
import { desktopNetworkAccessStateAtom } from "../../state/desktopNetworkAccess";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import {
  readEnvironmentScope,
  useEnvironmentScope,
  useEnvironmentSessionState,
} from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { resolveAdvertisedEndpointPairingUrl } from "../settings/ConnectionsSettings.logic";
import { resolveMobileWebEndpoints } from "../settings/MobileAppSettingsRow";
import { resolveDesktopPairingUrl, resolveHostedPairingUrl } from "../settings/pairingUrls";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { QRCodeSvg } from "../ui/qr-code";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  getPrismuxRemoteConnectCopy,
  getRemoteEndpointPillClass,
  subscribePrismuxRemoteConnectDialog,
} from "./prismuxRemoteConnect.logic";

const EMPTY_ADVERTISED_ENDPOINTS: ReadonlyArray<AdvertisedEndpoint> = [];

export interface PrismuxRemoteConnectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function PrismuxRemoteConnectDialog({
  open,
  onOpenChange,
}: PrismuxRemoteConnectDialogProps) {
  const { locale } = useSyncExternalStore(subscribeI18n, getI18nSnapshot, getI18nSnapshot);
  const copy = getPrismuxRemoteConnectCopy(locale);
  const m = useMessages();
  const navigate = useNavigate();

  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [pairingCredential, setPairingCredential] = useState<string | null>(null);
  const [isCreatingPairing, setIsCreatingPairing] = useState(false);

  const primaryEnvironment = usePrimaryEnvironment();
  const primaryEnvironmentId = primaryEnvironment?.environmentId ?? null;
  const canReadAccess = useEnvironmentScope(primaryEnvironmentId, AuthAccessReadScope);
  const canWriteAccess = useEnvironmentScope(primaryEnvironmentId, AuthAccessWriteScope);
  const sessionState = useEnvironmentSessionState(primaryEnvironmentId);
  const grantedScopes = sessionState.data?.authenticated
    ? (sessionState.data.permissions ?? sessionState.data.scopes ?? [])
    : [];
  const delegatableScopes: ReadonlyArray<AuthGrantScope> = AuthStandardClientScopes.filter(
    (scope) => grantedScopes.includes(scope),
  );

  const desktopNetworkAccess = useEnvironmentQuery(
    open && isElectron && typeof window !== "undefined" && Boolean(window.desktopBridge)
      ? desktopNetworkAccessStateAtom
      : null,
    m,
  );
  const authAccessChanges = useEnvironmentQuery(
    open && canReadAccess && primaryEnvironmentId !== null
      ? authEnvironment.accessChanges({ environmentId: primaryEnvironmentId, input: null })
      : null,
    m,
  );
  const createPairingCredential = useAtomCommand(authEnvironment.createPairingCredential, {
    reportFailure: false,
  });

  const advertisedEndpoints =
    desktopNetworkAccess.data?.advertisedEndpoints ?? EMPTY_ADVERTISED_ENDPOINTS;
  const currentOrigin =
    typeof window !== "undefined" && !isElectron ? window.location.origin : null;
  const endpoints = resolveMobileWebEndpoints({
    exposureState: desktopNetworkAccess.data?.serverExposureState ?? null,
    advertisedEndpoints,
    directEndpoints: primaryEnvironment?.serverConfig?.directEndpoints ?? null,
    currentOrigin,
  });
  const activeEndpoint =
    endpoints.find((candidate) => candidate.id === selectedEndpointId) ?? endpoints[0] ?? null;

  const connectedClientCount =
    authAccessChanges.data?.type === "snapshot"
      ? authAccessChanges.data.payload.clientSessions.length
      : null;

  // Build either the authenticated one-time pairing URL (once minted) or the direct mobile URL.
  const activeMobileUrl = (() => {
    if (!activeEndpoint) return null;
    if (!pairingCredential) return activeEndpoint.url;
    const matchedAdvertised = advertisedEndpoints.find((ep) => ep.id === activeEndpoint.id);
    if (matchedAdvertised) {
      return resolveAdvertisedEndpointPairingUrl(matchedAdvertised, pairingCredential);
    }
    return (
      resolveHostedPairingUrl(activeEndpoint.url, pairingCredential) ??
      resolveDesktopPairingUrl(activeEndpoint.url, pairingCredential)
    );
  })();

  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "Prismux Mobile URL",
      unavailableMessage: msg("Clipboard API is unavailable while copying URL."),
      failureMessage: msg("Failed to copy Prismux Mobile URL to the clipboard."),
    },
    timeout: 1_500,
  });

  const handleCreateOneTimePairing = async () => {
    if (
      primaryEnvironmentId === null ||
      isCreatingPairing ||
      !readEnvironmentScope(primaryEnvironmentId, AuthAccessWriteScope)
    ) {
      return;
    }
    const scopes =
      delegatableScopes.length > 0 ? delegatableScopes : [...AuthStandardClientScopes];
    setIsCreatingPairing(true);
    const result = await createPairingCredential({
      environmentId: primaryEnvironmentId,
      input: { label: "Prismux Mobile", scopes },
    });
    if (result._tag === "Success") {
      setPairingCredential(result.value.credential);
    } else if (!isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: copy.mobileWebCreatePairing,
          description:
            error instanceof Error
              ? (thrownErrorMessage(error, m) ?? error.message)
              : String(error),
        }),
      );
    }
    setIsCreatingPairing(false);
  };

  const handleOpenSharingSettings = () => {
    onOpenChange(false);
    void navigate({ to: "/settings/connections", hash: "remote-access" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup data-testid="prismux-remote-connect-dialog" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <QrCodeIcon aria-hidden className="size-4 text-primary" />
              <span>{copy.dialogTitle}</span>
            </span>
          </DialogTitle>
          <DialogDescription>{copy.dialogDescription}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div
            data-testid="remote-connect-panel-mobile-web"
            className="space-y-3 rounded-lg border border-border/75 bg-muted/25 p-3.5 [[data-pmx-glass='1']_&]:border-border/60 [[data-pmx-glass='1']_&]:bg-background/45"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{copy.mobileWebTitle}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {activeEndpoint ? copy.mobileWebDesc : copy.mobileWebOfflineDesc}
                </p>
              </div>
              {connectedClientCount !== null ? (
                <Badge variant="outline" size="sm">
                  {copy.mobileWebConnectedSessions(connectedClientCount)}
                </Badge>
              ) : null}
            </div>

            {activeEndpoint && activeMobileUrl ? (
              <>
                {endpoints.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {endpoints.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={option.id === activeEndpoint.id}
                        onClick={() => setSelectedEndpointId(option.id)}
                        className={getRemoteEndpointPillClass(option.id === activeEndpoint.id)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-col items-center gap-3 rounded-lg border border-border/70 bg-background/65 p-3 sm:flex-row">
                  <div className="shrink-0 rounded-lg border border-black/10 bg-white p-2 shadow-xs">
                    <QRCodeSvg
                      value={activeMobileUrl}
                      size={152}
                      level="M"
                      marginSize={1}
                      title={copy.mobileWebTitle}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" size="sm">
                        {activeEndpoint.kind === "tailscale" ? "Tailscale HTTPS" : "LAN"}
                      </Badge>
                      {pairingCredential ? (
                        <Badge variant="success" size="sm">
                          {copy.mobileWebPairingReadyBadge}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1.5 rounded-md border border-border/75 bg-muted/45 px-2 py-1">
                      <code
                        data-testid="mobile-web-active-url"
                        className="min-w-0 flex-1 truncate font-mono text-xs text-foreground"
                      >
                        {activeMobileUrl}
                      </code>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost-muted"
                        aria-label={isCopied ? copy.copied : copy.copyLink}
                        onClick={() => copyToClipboard(activeMobileUrl)}
                      >
                        {isCopied ? (
                          <CheckIcon className="size-3 text-success" />
                        ) : (
                          <CopyIcon className="size-3" />
                        )}
                      </Button>
                    </div>
                    {canWriteAccess && primaryEnvironmentId !== null ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        data-testid="mobile-web-create-pairing-button"
                        disabled={isCreatingPairing}
                        onClick={() => void handleCreateOneTimePairing()}
                      >
                        {isCreatingPairing ? (
                          <Spinner size="xs" />
                        ) : (
                          <KeyRoundIcon aria-hidden className="size-3" />
                        )}
                        <span>
                          {isCreatingPairing
                            ? copy.mobileWebCreatingPairing
                            : copy.mobileWebCreatePairing}
                        </span>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/75 bg-background/40 px-4 py-5 text-center">
                <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground">
                  <WifiOffIcon aria-hidden className="size-4" />
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleOpenSharingSettings}
                >
                  <span>{copy.openSharingSettings}</span>
                  <ArrowUpRightIcon aria-hidden className="size-3.5" />
                </Button>
              </div>
            )}
          </div>
        </DialogPanel>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="remote-connect-open-sharing-settings"
            onClick={handleOpenSharingSettings}
          >
            <Settings2Icon aria-hidden className="size-3.5" />
            <span>{copy.openSharingSettings}</span>
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
            {copy.close}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/**
 * Global host mounted once in `__root.tsx` so opening QR remote access from
 * settings or the system tray shows the same pure QR pairing dialog.
 */
export function PrismuxRemoteConnectDialogHost() {
  const [open, setOpen] = useState(false);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to imperative remote-connect modal pub/sub events
  useEffect(() => {
    return subscribePrismuxRemoteConnectDialog(() => {
      setOpen(true);
    });
  }, []);

  return <PrismuxRemoteConnectDialog open={open} onOpenChange={setOpen} />;
}
