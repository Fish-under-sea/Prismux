import type { EnvironmentCloudLinkStateResult } from "@t3tools/contracts";
import type { RelayManagedEndpoint } from "@t3tools/contracts/relay";
import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { parseUrl } from "@t3tools/shared/url";

import {
  hasCloudPublicConfig,
  resolveCloudPublicConfig,
  type CloudPublicConfig,
} from "../../cloud/publicConfig";
import { configuredHostedAppUrl } from "../../hostedPairing";
import { isElectron } from "../../env";

export type PrismuxRemoteConnectTab = "t3-connect" | "mobile-web";

export interface OpenPrismuxRemoteConnectOptions {
  readonly tab?: PrismuxRemoteConnectTab;
}

type RemoteConnectDialogListener = (options: OpenPrismuxRemoteConnectOptions) => void;

const remoteConnectListeners = new Set<RemoteConnectDialogListener>();

export function openPrismuxRemoteConnectDialog(
  options: OpenPrismuxRemoteConnectOptions = {},
): void {
  for (const listener of remoteConnectListeners) {
    listener(options);
  }
}

export function subscribePrismuxRemoteConnectDialog(
  listener: RemoteConnectDialogListener,
): () => void {
  remoteConnectListeners.add(listener);
  return () => {
    remoteConnectListeners.delete(listener);
  };
}

export type T3ConnectAvailability =
  | {
      readonly kind: "ready";
      readonly relayUrl: string;
      readonly hostedAppUrl: string;
    }
  | {
      readonly kind: "desktop-or-hosted-required";
      readonly relayUrl: string;
      readonly hostedAppUrl: string;
    }
  | {
      readonly kind: "unconfigured";
      readonly relayUrl: string | null;
      readonly hostedAppUrl: string;
      readonly missingKeys: ReadonlyArray<string>;
    };

export function resolveT3ConnectAvailability(input?: {
  readonly publicConfig?: CloudPublicConfig;
  readonly cloudConfigReady?: boolean;
  readonly isElectronHost?: boolean;
  readonly hostedAppUrl?: string;
}): T3ConnectAvailability {
  const config = input?.publicConfig ?? resolveCloudPublicConfig();
  const hostedAppUrl = input?.hostedAppUrl?.trim() || configuredHostedAppUrl() || DEFAULT_HOSTED_APP_URL;
  const ready = input?.cloudConfigReady ?? hasCloudPublicConfig();

  if (ready && config.relayUrl) {
    return {
      kind: "ready",
      relayUrl: config.relayUrl,
      hostedAppUrl,
    };
  }

  const missingKeys: string[] = [];
  if (!config.clerkPublishableKey) missingKeys.push("T3CODE_CLERK_PUBLISHABLE_KEY");
  if (!config.clerkJwtTemplate) missingKeys.push("T3CODE_CLERK_JWT_TEMPLATE");
  if (!config.relayUrl) missingKeys.push("T3CODE_RELAY_URL");

  if (missingKeys.length > 0) {
    return {
      kind: "unconfigured",
      relayUrl: config.relayUrl,
      hostedAppUrl,
      missingKeys,
    };
  }

  const inElectron = input?.isElectronHost ?? isElectron;
  if (!inElectron && config.clerkPublishableKey?.startsWith("pk_live_") && config.relayUrl) {
    return {
      kind: "desktop-or-hosted-required",
      relayUrl: config.relayUrl,
      hostedAppUrl,
    };
  }

  return {
    kind: "unconfigured",
    relayUrl: config.relayUrl,
    hostedAppUrl,
    missingKeys,
  };
}

export type T3ConnectRelayStatusKind =
  | "online"
  | "checking"
  | "unreachable"
  | "revoked"
  | "inactive";

export interface T3ConnectRemoteAccessSummary {
  readonly status: T3ConnectRelayStatusKind;
  readonly remoteWebUrl: string;
  readonly tunnelOriginUrl: string | null;
  readonly qrUrl: string;
  readonly relayUrl: string | null;
}

const VALID_TUNNEL_HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function resolveT3ConnectTunnelOriginUrl(input: {
  readonly tunnelHostname?: string | null | undefined;
  readonly relayEndpoint?: RelayManagedEndpoint | null | undefined;
}): string | null {
  const hostCandidate = input.tunnelHostname?.trim();
  if (hostCandidate && VALID_TUNNEL_HOSTNAME.test(hostCandidate)) {
    const parsed = parseUrl(`https://${hostCandidate}`);
    if (parsed?.protocol === "https:") {
      return parsed.origin;
    }
  }

  if (input.relayEndpoint?.providerKind === "cloudflare_tunnel") {
    const parsed = parseUrl(input.relayEndpoint.httpBaseUrl);
    if (parsed?.protocol === "https:" && VALID_TUNNEL_HOSTNAME.test(parsed.hostname)) {
      return parsed.origin;
    }
  }

  return null;
}

export function resolveT3ConnectRemoteAccess(input: {
  readonly managedTunnelActive: boolean;
  readonly linkRevoked: boolean;
  readonly linkState: EnvironmentCloudLinkStateResult | null;
  readonly relayEndpoint?: RelayManagedEndpoint | null | undefined;
  readonly configuredRelayUrl?: string | null | undefined;
  readonly hostedAppUrl?: string | null | undefined;
}): T3ConnectRemoteAccessSummary {
  const remoteWebUrl = (
    input.hostedAppUrl?.trim() ||
    configuredHostedAppUrl() ||
    DEFAULT_HOSTED_APP_URL
  ).replace(/\/+$/, "");
  const tunnelOriginUrl = input.managedTunnelActive
    ? resolveT3ConnectTunnelOriginUrl({
        tunnelHostname: input.linkState?.tunnelHostname,
        relayEndpoint: input.relayEndpoint,
      })
    : null;
  const relayUrl = input.linkState?.relayUrl ?? input.configuredRelayUrl ?? null;

  let status: T3ConnectRelayStatusKind = "inactive";
  if (input.linkRevoked) {
    status = "revoked";
  } else if (input.managedTunnelActive) {
    const reachability = input.linkState?.reachability?.status;
    if (reachability === "reachable") {
      status = "online";
    } else if (reachability === "unreachable") {
      status = "unreachable";
    } else {
      status = "checking";
    }
  }

  return {
    status,
    remoteWebUrl,
    tunnelOriginUrl,
    qrUrl: remoteWebUrl,
    relayUrl,
  };
}

export interface T3CodeAccountIdentity {
  readonly displayName: string;
  readonly email: string | null;
  readonly imageUrl: string | null;
  readonly initials: string;
}

export interface ClerkUserLike {
  readonly fullName?: string | null;
  readonly firstName?: string | null;
  readonly username?: string | null;
  readonly imageUrl?: string | null;
  readonly primaryEmailAddress?: { readonly emailAddress?: string | null } | null;
  readonly emailAddresses?: ReadonlyArray<{ readonly emailAddress?: string | null }>;
}

export function formatT3CodeAccountIdentity(
  user: ClerkUserLike | null | undefined,
): T3CodeAccountIdentity {
  const email =
    user?.primaryEmailAddress?.emailAddress?.trim() ||
    user?.emailAddresses?.find((entry) => entry.emailAddress?.trim())?.emailAddress?.trim() ||
    null;
  const displayName =
    user?.fullName?.trim() ||
    user?.firstName?.trim() ||
    user?.username?.trim() ||
    email ||
    "T3 Code Account";
  const initialsSource = displayName.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, " ").trim();
  const words = initialsSource.split(/\s+/).filter(Boolean);
  const initials =
    words.length >= 2
      ? `${words[0]!.charAt(0)}${words[1]!.charAt(0)}`.toUpperCase()
      : initialsSource.slice(0, 2).toUpperCase() || "T3";

  return {
    displayName,
    email: email && email !== displayName ? email : null,
    imageUrl: user?.imageUrl?.trim() || null,
    initials,
  };
}

/**
 * High-contrast 3-state (Light / Dark / Glass) segmented tab button classes
 * so selected tabs are immediately legible and never wash out or blend into the rail.
 */
export function getRemoteConnectTabButtonClass(active: boolean): string {
  return active
    ? [
        "flex-1 cursor-pointer rounded-md border px-3 py-1.5 text-xs font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "border-primary/80 bg-primary text-primary-foreground shadow-xs",
      ].join(" ")
    : [
        "flex-1 cursor-pointer rounded-md border border-transparent px-3 py-1.5 text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "bg-transparent text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
      ].join(" ");
}

export function getRemoteEndpointPillClass(active: boolean): string {
  return active
    ? [
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "border-primary/80 bg-primary text-primary-foreground shadow-xs",
      ].join(" ")
    : [
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 py-1 text-xs font-medium text-foreground/80 transition-all outline-none hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        "[[data-pmx-glass='1']_&]:bg-background/35",
      ].join(" ");
}

export interface PrismuxRemoteConnectCopy {
  readonly dialogTitle: string;
  readonly dialogDescription: string;
  readonly tabT3Connect: string;
  readonly tabMobileWeb: string;
  readonly t3ConnectTitle: string;
  readonly t3ConnectSignedOutDesc: string;
  readonly t3ConnectSignInButton: string;
  readonly t3ConnectSigningIn: string;
  readonly t3ConnectSignOutButton: string;
  readonly t3ConnectSigningOut: string;
  readonly t3ConnectManageAccount: string;
  readonly t3ConnectLoadingAuth: string;
  readonly t3ConnectAuthLoadFailed: string;
  readonly t3ConnectRetryAuth: string;
  readonly t3ConnectToggleTitle: string;
  readonly t3ConnectToggleDesc: string;
  readonly t3ConnectStatusOnline: string;
  readonly t3ConnectStatusChecking: string;
  readonly t3ConnectStatusUnreachable: string;
  readonly t3ConnectStatusRevoked: string;
  readonly t3ConnectStatusInactive: string;
  readonly t3ConnectRemoteUrlLabel: string;
  readonly t3ConnectTunnelOriginLabel: string;
  readonly t3ConnectScanHint: string;
  readonly t3ConnectOpenHosted: string;
  readonly t3ConnectRelayServerLabel: string;
  readonly t3ConnectDesktopRequiredDesc: string;
  readonly t3ConnectUnconfiguredDesc: string;
  readonly t3ConnectHostCommandHint: string;
  readonly t3ConnectSignOutFailedTitle: string;
  readonly t3ConnectSignInFailedTitle: string;
  readonly mobileWebTitle: string;
  readonly mobileWebDesc: string;
  readonly mobileWebOfflineDesc: string;
  readonly mobileWebCreatePairing: string;
  readonly mobileWebCreatingPairing: string;
  readonly mobileWebPairingReadyBadge: string;
  readonly mobileWebConnectedSessions: (count: number) => string;
  readonly mobileWebSwitchToT3Connect: string;
  readonly copyLink: string;
  readonly copied: string;
  readonly openSharingSettings: string;
  readonly close: string;
}

const ZH_COPY: PrismuxRemoteConnectCopy = {
  dialogTitle: "远程连接 · Prismux 手机端",
  dialogDescription: "通过 T3 Code 账户（T3 Connect）中继远控，或在同一网络下使用手机扫码直连。",
  tabT3Connect: "T3 Connect（T3 Code 账户）",
  tabMobileWeb: "手机 Web 扫码（局域网 / Tailscale）",
  t3ConnectTitle: "T3 Code 账户远控（T3 Connect）",
  t3ConnectSignedOutDesc:
    "登录 T3 Code 账户，通过 T3 Code 服务器安全中继远程控制本机工作台，无需公网 IP 或内网穿透。",
  t3ConnectSignInButton: "登录 T3 Code 账户",
  t3ConnectSigningIn: "正在打开登录…",
  t3ConnectSignOutButton: "退出 T3 Code 账户",
  t3ConnectSigningOut: "正在退出…",
  t3ConnectManageAccount: "账户与设备",
  t3ConnectLoadingAuth: "正在初始化 T3 Code 账户服务…",
  t3ConnectAuthLoadFailed: "T3 Code 认证服务加载失败，请检查网络后重试。",
  t3ConnectRetryAuth: "重试连接",
  t3ConnectToggleTitle: "通过 T3 Code 服务器远控本机",
  t3ConnectToggleDesc: "开启后，本机将通过 T3 Connect 安全隧道在线，手机或浏览器登录同一账户即可直连。",
  t3ConnectStatusOnline: "Relay 已在线",
  t3ConnectStatusChecking: "中继检测中",
  t3ConnectStatusUnreachable: "中继不可达",
  t3ConnectStatusRevoked: "已从账户移除",
  t3ConnectStatusInactive: "未开启远控",
  t3ConnectRemoteUrlLabel: "T3 Connect 远控地址",
  t3ConnectTunnelOriginLabel: "安全隧道地址",
  t3ConnectScanHint: "用手机扫码或在其他设备浏览器打开，登录同一 T3 Code 账户即可远程控制本机工作台。",
  t3ConnectOpenHosted: "打开网页端",
  t3ConnectRelayServerLabel: "中继服务器",
  t3ConnectDesktopRequiredDesc:
    "当前页面运行在本地浏览器域，T3 Code 账户登录需在 Prismux 桌面客户端或 app.t3.codes 中完成，也可在主机终端执行 `t3 connect` 绑定。",
  t3ConnectUnconfiguredDesc:
    "当前构建未启用 T3 Connect 公共中继配置，请配置 T3CODE_RELAY_URL 与 Clerk 公钥后重试，或使用局域网 / Tailscale 直连。",
  t3ConnectHostCommandHint: "命令行备选：t3 connect",
  t3ConnectSignOutFailedTitle: "退出 T3 Code 账户失败",
  t3ConnectSignInFailedTitle: "无法打开 T3 Code 登录",
  mobileWebTitle: "局域网 / Tailscale 手机扫码",
  mobileWebDesc: "在同一局域网或 Tailscale 网络下，直接用手机扫码打开工作台或生成一次性配对链接。",
  mobileWebOfflineDesc:
    "当前未开启局域网访问或 Tailscale HTTPS。你可以前往「共享与访问」开启，或切换到左侧 T3 Connect 直接通过 T3 Code 服务器远控。",
  mobileWebCreatePairing: "生成一次性配对二维码",
  mobileWebCreatingPairing: "正在生成配对码…",
  mobileWebPairingReadyBadge: "已含一次性配对令牌",
  mobileWebConnectedSessions: (count) => `当前已授权设备会话：${count} 台`,
  mobileWebSwitchToT3Connect: "改用 T3 Connect 服务器远控",
  copyLink: "复制链接",
  copied: "已复制",
  openSharingSettings: "共享与访问设置",
  close: "关闭",
};

const EN_COPY: PrismuxRemoteConnectCopy = {
  dialogTitle: "Remote Access · Prismux Mobile",
  dialogDescription:
    "Sign in to your T3 Code account (T3 Connect) for zero-config relay control, or scan over LAN / Tailscale.",
  tabT3Connect: "T3 Connect (T3 Code Account)",
  tabMobileWeb: "Mobile Web QR (LAN / Tailscale)",
  t3ConnectTitle: "T3 Code Account Remote Control (T3 Connect)",
  t3ConnectSignedOutDesc:
    "Sign in to your T3 Code account to remotely control this workbench through the T3 Connect relay server—no public IP or port forwarding needed.",
  t3ConnectSignInButton: "Sign in to T3 Code Account",
  t3ConnectSigningIn: "Opening sign-in…",
  t3ConnectSignOutButton: "Sign out",
  t3ConnectSigningOut: "Signing out…",
  t3ConnectManageAccount: "Account & devices",
  t3ConnectLoadingAuth: "Connecting to T3 Code account service…",
  t3ConnectAuthLoadFailed: "Could not load T3 Code authentication. Check your network and retry.",
  t3ConnectRetryAuth: "Retry T3 Connect",
  t3ConnectToggleTitle: "Enable remote control via T3 Connect server",
  t3ConnectToggleDesc:
    "Publishes this machine through T3 Connect so any phone or browser signed into the same T3 Code account can control it.",
  t3ConnectStatusOnline: "Relay online",
  t3ConnectStatusChecking: "Checking relay",
  t3ConnectStatusUnreachable: "Relay unreachable",
  t3ConnectStatusRevoked: "Removed from account",
  t3ConnectStatusInactive: "Remote off",
  t3ConnectRemoteUrlLabel: "T3 Connect remote URL",
  t3ConnectTunnelOriginLabel: "Managed tunnel origin",
  t3ConnectScanHint:
    "Scan with your phone or open on another device and sign in to the same T3 Code account to control this workbench.",
  t3ConnectOpenHosted: "Open web app",
  t3ConnectRelayServerLabel: "Relay server",
  t3ConnectDesktopRequiredDesc:
    "T3 Code account sign-in requires the Prismux desktop app or app.t3.codes on private HTTP browser origins. You can also run `t3 connect` on the host.",
  t3ConnectUnconfiguredDesc:
    "T3 Connect public relay configuration is disabled in this build. Configure T3CODE_RELAY_URL and Clerk keys, or use LAN / Tailscale pairing.",
  t3ConnectHostCommandHint: "CLI alternative: t3 connect",
  t3ConnectSignOutFailedTitle: "Could not sign out of T3 Code account",
  t3ConnectSignInFailedTitle: "Could not start T3 Code sign-in",
  mobileWebTitle: "LAN / Tailscale Mobile QR",
  mobileWebDesc:
    "Scan with your phone browser on the same local network or Tailnet, or mint a one-time pairing QR code.",
  mobileWebOfflineDesc:
    "Local network access and Tailscale HTTPS are currently off. Enable them in Sharing & access, or switch to T3 Connect to connect through T3 Code servers.",
  mobileWebCreatePairing: "Generate one-time pairing QR",
  mobileWebCreatingPairing: "Creating pairing link…",
  mobileWebPairingReadyBadge: "One-time pairing token embedded",
  mobileWebConnectedSessions: (count) => `Authorized client sessions: ${count}`,
  mobileWebSwitchToT3Connect: "Use T3 Connect relay instead",
  copyLink: "Copy link",
  copied: "Copied",
  openSharingSettings: "Sharing & access settings",
  close: "Close",
};

export function getPrismuxRemoteConnectCopy(locale: string | null | undefined): PrismuxRemoteConnectCopy {
  return (locale ?? "").toLowerCase().startsWith("en") ? EN_COPY : ZH_COPY;
}
