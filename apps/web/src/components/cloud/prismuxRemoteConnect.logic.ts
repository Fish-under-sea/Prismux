export type PrismuxRemoteConnectTab = "mobile-web";

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

export function getRemoteEndpointPillClass(active: boolean): string {
  return active
    ? [
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-all outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        "border-primary/80 bg-primary text-primary-foreground shadow-xs",
      ].join(" ")
    : [
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 py-1 text-xs font-medium text-foreground/80 transition-all outline-none hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        "[[data-pmx-glass='1']_&]:bg-background/35",
      ].join(" ");
}

export interface PrismuxRemoteConnectCopy {
  readonly dialogTitle: string;
  readonly dialogDescription: string;
  readonly mobileWebTitle: string;
  readonly mobileWebDesc: string;
  readonly mobileWebOfflineDesc: string;
  readonly mobileWebCreatePairing: string;
  readonly mobileWebCreatingPairing: string;
  readonly mobileWebPairingReadyBadge: string;
  readonly mobileWebConnectedSessions: (count: number) => string;
  readonly copyLink: string;
  readonly copied: string;
  readonly openSharingSettings: string;
  readonly close: string;
}

const ZH_COPY: PrismuxRemoteConnectCopy = {
  dialogTitle: "扫码远控",
  dialogDescription:
    "在同一局域网或 Tailscale 网络下，使用手机浏览器或 Prismux 手机端 App 扫描二维码直连本机工作台，无需登录云端账号。",
  mobileWebTitle: "局域网 / Tailscale 二维码直连",
  mobileWebDesc:
    "扫描下方二维码打开工作台，或生成带一次性配对令牌的安全二维码供手机端直接配对。",
  mobileWebOfflineDesc:
    "当前未开启局域网访问或 Tailscale HTTPS。请前往「环境与扫码远控」开启局域网访问或配置 Tailscale HTTPS 后重试。",
  mobileWebCreatePairing: "生成一次性配对二维码",
  mobileWebCreatingPairing: "正在生成配对码…",
  mobileWebPairingReadyBadge: "已含一次性配对令牌",
  mobileWebConnectedSessions: (count) => `当前已授权设备会话：${count} 台`,
  copyLink: "复制链接",
  copied: "已复制",
  openSharingSettings: "环境与扫码远控设置",
  close: "关闭",
};

const EN_COPY: PrismuxRemoteConnectCopy = {
  dialogTitle: "QR Remote Access",
  dialogDescription:
    "Scan with your phone browser or Prismux mobile app over your local network or Tailscale, with no cloud account required.",
  mobileWebTitle: "LAN / Tailscale QR Pairing",
  mobileWebDesc:
    "Scan the QR code below to open this workbench on your phone, or mint a one-time pairing QR code for direct device pairing.",
  mobileWebOfflineDesc:
    "Local network access and Tailscale HTTPS are currently off. Enable network access or Tailscale HTTPS in Environments & remote access to connect by QR code.",
  mobileWebCreatePairing: "Generate one-time pairing QR",
  mobileWebCreatingPairing: "Creating pairing link…",
  mobileWebPairingReadyBadge: "One-time pairing token embedded",
  mobileWebConnectedSessions: (count) => `Authorized client sessions: ${count}`,
  copyLink: "Copy link",
  copied: "Copied",
  openSharingSettings: "Environments & remote access",
  close: "Close",
};

export function getPrismuxRemoteConnectCopy(
  locale: string | null | undefined,
): PrismuxRemoteConnectCopy {
  return (locale ?? "").toLowerCase().startsWith("en") ? EN_COPY : ZH_COPY;
}
