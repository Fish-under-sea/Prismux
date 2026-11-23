import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  QrCodeIcon,
  SmartphoneIcon,
  WifiOffIcon,
} from "lucide-react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import type { AdvertisedEndpoint, DesktopServerExposureState } from "@t3tools/contracts";

import { isElectron } from "../../env";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { desktopNetworkAccessStateAtom } from "../../state/desktopNetworkAccess";
import { usePrimaryEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { AndroidIcon, AppleIcon } from "../Icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { QRCodeSvg } from "../ui/qr-code";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export const MOBILE_APP_STORES = [
  {
    id: "ios",
    label: msg("iPhone and iPad"),
    store: "App Store",
    url: "https://apps.apple.com/us/app/t3-code-remote-claude-more/id6787819824",
    Icon: AppleIcon,
  },
  {
    id: "android",
    label: "Android",
    store: "Google Play",
    url: "https://play.google.com/store/apps/details?id=com.t3tools.t3code",
    Icon: AndroidIcon,
  },
] as const;

export interface MobileWebEndpointOption {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly kind: "tailscale" | "lan" | "origin";
}

function isLoopbackHost(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower === "[::1]" ||
    lower.startsWith("127.")
  );
}

function isShareableWebUrl(raw: string | null | undefined): raw is string {
  if (!raw || typeof raw !== "string") return false;
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return !isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

export function resolveMobileWebEndpoints(input: {
  readonly exposureState?: DesktopServerExposureState | null;
  readonly advertisedEndpoints?: ReadonlyArray<AdvertisedEndpoint>;
  readonly directEndpoints?: ReadonlyArray<
    string | { readonly kind?: string; readonly httpBaseUrl: string }
  > | null;
  readonly currentOrigin?: string | null;
}): ReadonlyArray<MobileWebEndpointOption> {
  const seen = new Set<string>();
  const results: MobileWebEndpointOption[] = [];

  const pushUnique = (option: MobileWebEndpointOption) => {
    const normalized = option.url.replace(/\/+$/, "");
    if (!isShareableWebUrl(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    results.push({ ...option, url: normalized });
  };

  for (const endpoint of input.advertisedEndpoints ?? []) {
    if (endpoint.status !== "available") continue;
    const isTailscale =
      endpoint.provider.kind === "private-network" ||
      endpoint.provider.id.toLowerCase().includes("tailscale") ||
      endpoint.label.toLowerCase().includes("tailscale") ||
      endpoint.httpBaseUrl.includes(".ts.net");
    if (!isTailscale && input.exposureState?.mode === "local-only") continue;
    pushUnique({
      id: endpoint.id,
      label: endpoint.label || (isTailscale ? "Tailscale HTTPS" : "LAN"),
      url: endpoint.httpBaseUrl,
      kind: isTailscale ? "tailscale" : "lan",
    });
  }

  if (input.exposureState?.mode === "network-accessible" && input.exposureState.endpointUrl) {
    pushUnique({
      id: "exposure-endpoint",
      label: "LAN",
      url: input.exposureState.endpointUrl,
      kind: "lan",
    });
  }

  for (const entry of input.directEndpoints ?? []) {
    const url = typeof entry === "string" ? entry : entry.httpBaseUrl;
    const isTailnet =
      (typeof entry !== "string" && entry.kind === "tailnet") || url.includes(".ts.net");
    if (input.exposureState?.mode === "local-only" && !isTailnet) continue;
    pushUnique({
      id: `direct-${url}`,
      label: isTailnet ? "Tailscale" : "LAN",
      url,
      kind: isTailnet ? "tailscale" : "lan",
    });
  }

  if (results.length === 0 && input.currentOrigin) {
    pushUnique({
      id: "current-origin",
      label: "Web",
      url: input.currentOrigin,
      kind: "origin",
    });
  }

  return results;
}

export function MobileAppSettingsRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const primaryEnvironment = usePrimaryEnvironment();
  const desktopNetworkAccess = useEnvironmentQuery(
    isElectron && typeof window !== "undefined" && Boolean(window.desktopBridge)
      ? desktopNetworkAccessStateAtom
      : null,
    m,
  );

  const currentOrigin =
    typeof window !== "undefined" && !isElectron ? window.location.origin : null;
  const endpoints = resolveMobileWebEndpoints({
    exposureState: desktopNetworkAccess.data?.serverExposureState ?? null,
    advertisedEndpoints: desktopNetworkAccess.data?.advertisedEndpoints ?? [],
    directEndpoints: primaryEnvironment?.serverConfig?.directEndpoints ?? null,
    currentOrigin,
  });

  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const activeEndpoint =
    endpoints.find((candidate) => candidate.id === selectedEndpointId) ?? endpoints[0] ?? null;

  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: {
      target: "Prismux Web URL",
      unavailableMessage: msg("Clipboard API is unavailable while copying URL."),
      failureMessage: msg("Failed to copy Prismux Web URL to the clipboard."),
    },
    timeout: 1_500,
  });

  const hasLanAccess = activeEndpoint !== null;

  return (
    <SettingsRow
      {...searchableSetting("mobile-app")}
      title={gt("Mobile Web access")}
      description={
        hasLanAccess
          ? gt("Scan the QR code with your phone browser to open this Prismux workspace over LAN or Tailscale.")
          : gt("LAN access is off. Enable network access or Tailscale HTTPS in Sharing & access to scan and connect from your phone browser.")
      }
      control={
        <div className="flex flex-wrap items-center gap-2">
          {hasLanAccess ? (
            <Popover>
              <PopoverTrigger render={<Button size="sm" variant="outline" />}>
                <QrCodeIcon className="size-3.5" />
                <T>Scan to open Prismux Web</T>
              </PopoverTrigger>
              <PopoverPopup align="end" className="w-72">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex w-full items-center justify-between gap-2">
                    <PopoverTitle className="flex items-center gap-1.5 text-sm">
                      <SmartphoneIcon className="size-3.5 text-muted-foreground" />
                      <T>Open Prismux Web on phone</T>
                    </PopoverTitle>
                    <Badge variant="outline" className="shrink-0">
                      {activeEndpoint.kind === "tailscale" ? "Tailscale" : "LAN"}
                    </Badge>
                  </div>
                  <p className="w-full text-xs text-muted-foreground">
                    <T>Scan with your phone camera on the same network or Tailnet, then pair in Sharing &amp; access if prompted.</T>
                  </p>
                  {endpoints.length > 1 ? (
                    <div className="flex w-full flex-wrap gap-1">
                      {endpoints.map((option) => (
                        <Button
                          key={option.id}
                          type="button"
                          size="xs"
                          variant={option.id === activeEndpoint.id ? "secondary" : "ghost"}
                          onClick={() => setSelectedEndpointId(option.id)}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <div className="rounded-lg bg-white p-2">
                    <QRCodeSvg
                      value={activeEndpoint.url}
                      size={144}
                      level="M"
                      marginSize={1}
                      title={gt("Prismux Web QR code")}
                    />
                  </div>
                  <div className="flex w-full items-center gap-1 rounded-md border border-border/70 bg-muted/40 px-2 py-1">
                    <code className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground">
                      {activeEndpoint.url}
                    </code>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label={isCopied ? gt("Copied URL") : gt("Copy URL")}
                      onClick={() => copyToClipboard(activeEndpoint.url)}
                    >
                      {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
                    </Button>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="w-full"
                    render={<Link to="/settings/access" />}
                  >
                    <T>Manage pairing &amp; access</T>
                    <ArrowUpRightIcon className="size-3" />
                  </Button>
                </div>
              </PopoverPopup>
            </Popover>
          ) : (
            <Button size="sm" variant="outline" render={<Link to="/settings/access" />}>
              <WifiOffIcon className="size-3.5 text-muted-foreground" />
              <T>Enable LAN access</T>
              <ArrowUpRightIcon className="size-3" />
            </Button>
          )}
          {MOBILE_APP_STORES.map(({ id, label, store, url, Icon }) => (
            <Popover key={id}>
              <PopoverTrigger render={<Button size="sm" variant="outline" />}>
                <Icon />
                {m(label)}
              </PopoverTrigger>
              <PopoverPopup align="end">
                <div className="flex flex-col items-center gap-3">
                  <PopoverTitle>{store}</PopoverTitle>
                  <p className="text-xs text-muted-foreground">
                    <T>Scan with your phone camera.</T>
                  </p>
                  <div className="rounded-lg bg-white p-1.5">
                    <QRCodeSvg
                      value={url}
                      size={128}
                      level="M"
                      marginSize={1}
                      title={gt("{store} link", { store })}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<a href={url} target="_blank" rel="noreferrer noopener" />}
                  >
                    <T>
                      Open <Var>{store}</Var>
                    </T>
                  </Button>
                </div>
              </PopoverPopup>
            </Popover>
          ))}
        </div>
      }
    />
  );
}
