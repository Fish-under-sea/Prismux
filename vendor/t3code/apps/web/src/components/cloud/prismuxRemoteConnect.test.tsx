// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const clerkMockState = vi.hoisted(() => ({
  isLoaded: true,
  isSignedIn: false as boolean | undefined,
  status: "ready" as "ready" | "error",
  user: null as {
    readonly fullName?: string | null;
    readonly username?: string | null;
    readonly imageUrl?: string | null;
    readonly primaryEmailAddress?: { readonly emailAddress?: string | null } | null;
  } | null,
  openSignIn: vi.fn(),
  signOut: vi.fn(async () => undefined),
  openUserProfile: vi.fn(),
}));

const cloudControllerMockState = vi.hoisted(() => ({
  managedTunnelActive: false,
  managedTunnelOutOfSync: false,
  linkRevoked: false,
  publishAgentActivity: false,
  holdWebhooksWhileOffline: false,
  operationError: null as string | null,
  tunnelLimit: null as number | null,
  linkData: {
    linked: false,
    cloudUserId: null as string | null,
    relayUrl: "https://relay.t3.codes",
    relayIssuer: "https://relay.t3.codes",
    managedTunnelActive: false,
    publishAgentActivity: false,
    linkRevoked: false,
    tunnelHostname: undefined as string | undefined,
    reachability: undefined as
      | {
          readonly status: "reachable";
          readonly checkedAt: string;
          readonly readyConnections: number | null;
          readonly protocol: string | null;
        }
      | {
          readonly status: "unreachable";
          readonly checkedAt: string;
          readonly cause: "tunnel_down";
          readonly reason: string;
          readonly hint: string;
          readonly fix: string;
        }
      | undefined,
  },
  reconcileCloudState: vi.fn(async () => true),
}));

const cloudPublicConfigMock = vi.hoisted(() => ({
  ready: true,
  relayUrl: "https://relay.t3.codes" as string | null,
  clerkPublishableKey: "pk_live_Y2xlcmsudDMuY29kZXMk" as string | null,
  clerkJwtTemplate: "t3-relay" as string | null,
}));

vi.mock("gt-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gt-react")>();
  return {
    ...actual,
    useGT: () => (text: string) => text,
    useMessages: () => (entry: unknown) => (typeof entry === "string" ? entry : ""),
  };
});

vi.mock("@clerk/react", () => ({
  useAuth: () => ({
    isLoaded: clerkMockState.isLoaded,
    isSignedIn: clerkMockState.isSignedIn,
    getToken: vi.fn(async () => "mock-jwt"),
  }),
  useClerk: () => ({
    status: clerkMockState.status,
    user: clerkMockState.user,
    openSignIn: clerkMockState.openSignIn,
    signOut: clerkMockState.signOut,
    openUserProfile: clerkMockState.openUserProfile,
  }),
}));

vi.mock("../../cloud/publicConfig", () => ({
  hasCloudPublicConfig: () => cloudPublicConfigMock.ready,
  resolveCloudPublicConfig: () => ({
    clerkPublishableKey: cloudPublicConfigMock.clerkPublishableKey,
    clerkJwtTemplate: cloudPublicConfigMock.clerkJwtTemplate,
    relayUrl: cloudPublicConfigMock.relayUrl,
    relayTracing: { tracesUrl: null, tracesDataset: null, tracesToken: null },
  }),
  resolveRelayClerkTokenOptions: () => ({ template: "t3-relay" }),
  resolveRelayTracingConfig: () => null,
}));

vi.mock("../../cloud/useCloudLinkController", () => ({
  useCloudLinkController: () => ({
    isSignedIn: clerkMockState.isSignedIn,
    linkState: {
      data: cloudControllerMockState.linkData,
      error: null,
      isPending: false,
      refresh: vi.fn(),
      target: { environmentId: EnvironmentId.make("env-local") },
    },
    linked: cloudControllerMockState.linkData.linked,
    linkRevoked: cloudControllerMockState.linkRevoked,
    managedTunnelActive: cloudControllerMockState.managedTunnelActive,
    managedTunnelOutOfSync: cloudControllerMockState.managedTunnelOutOfSync,
    publishAgentActivity: cloudControllerMockState.publishAgentActivity,
    holdWebhooksWhileOffline: cloudControllerMockState.holdWebhooksWhileOffline,
    operationError: cloudControllerMockState.operationError,
    tunnelLimit: cloudControllerMockState.tunnelLimit,
    needsRelayConfiguration: () => false,
    reconcileCloudState: cloudControllerMockState.reconcileCloudState,
  }),
}));

vi.mock("../../cloud/useT3ConnectTurnOn", () => ({
  useT3ConnectTurnOn: () => ({ kind: "here" as const }),
}));

vi.mock("../../cloud/managedRelayState", () => ({
  useManagedTunnelUsage: () => ({ used: 1, limit: 3, upgrade: null, refresh: vi.fn() }),
}));

vi.mock("../../state/managedPolicy", () => ({
  useManagedPolicy: () => undefined,
}));

vi.mock("../../state/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/session")>();
  return {
    ...actual,
    readEnvironmentScope: () => true,
    useEnvironmentScope: () => true,
  };
});

vi.mock("../../state/relay", () => ({
  relayEnvironmentDiscovery: {
    stateValueAtom: { _tag: "mock" },
  },
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => ({ environments: new Map() }),
}));

vi.mock("../clerk/T3ConnectAccountPages", () => ({
  useT3ConnectAccountPage: () => ({
    open: clerkMockState.isSignedIn ? vi.fn() : null,
    portals: null,
  }),
}));

import { TooltipProvider } from "../ui/tooltip";
import { T3ConnectAccountCard } from "./T3ConnectAccountCard";
import {
  formatT3CodeAccountIdentity,
  getRemoteConnectTabButtonClass,
  getRemoteEndpointPillClass,
  openPrismuxRemoteConnectDialog,
  resolveT3ConnectAvailability,
  resolveT3ConnectRemoteAccess,
  resolveT3ConnectTunnelOriginUrl,
  subscribePrismuxRemoteConnectDialog,
} from "./prismuxRemoteConnect.logic";

describe("prismuxRemoteConnect logic & T3 Connect account remote control", () => {
  beforeEach(() => {
    clerkMockState.isLoaded = true;
    clerkMockState.isSignedIn = false;
    clerkMockState.status = "ready";
    clerkMockState.user = null;
    clerkMockState.openSignIn.mockReset();
    clerkMockState.signOut.mockReset();

    cloudPublicConfigMock.ready = true;
    cloudPublicConfigMock.relayUrl = "https://relay.t3.codes";
    cloudPublicConfigMock.clerkPublishableKey = "pk_live_Y2xlcmsudDMuY29kZXMk";
    cloudPublicConfigMock.clerkJwtTemplate = "t3-relay";

    cloudControllerMockState.managedTunnelActive = false;
    cloudControllerMockState.managedTunnelOutOfSync = false;
    cloudControllerMockState.linkRevoked = false;
    cloudControllerMockState.operationError = null;
    cloudControllerMockState.tunnelLimit = null;
    cloudControllerMockState.linkData = {
      linked: false,
      cloudUserId: null,
      relayUrl: "https://relay.t3.codes",
      relayIssuer: "https://relay.t3.codes",
      managedTunnelActive: false,
      publishAgentActivity: false,
      linkRevoked: false,
      tunnelHostname: undefined,
      reachability: undefined,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("notifies and unsubscribes centered remote-connect modal listeners with tab preference", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePrismuxRemoteConnectDialog(listener);

    openPrismuxRemoteConnectDialog({ tab: "t3-connect" });
    openPrismuxRemoteConnectDialog({ tab: "mobile-web" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { tab: "t3-connect" });
    expect(listener).toHaveBeenNthCalledWith(2, { tab: "mobile-web" });

    unsubscribe();
    openPrismuxRemoteConnectDialog({ tab: "t3-connect" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("classifies T3 Connect availability across Electron ready, local HTTP browser, and unconfigured builds", () => {
    const publicConfig = {
      clerkPublishableKey: "pk_live_Y2xlcmsudDMuY29kZXMk",
      clerkJwtTemplate: "t3-relay",
      relayUrl: "https://relay.t3.codes",
      relayTracing: { tracesUrl: null, tracesDataset: null, tracesToken: null },
    };

    expect(
      resolveT3ConnectAvailability({
        publicConfig,
        cloudConfigReady: true,
        isElectronHost: true,
      }),
    ).toEqual({
      kind: "ready",
      relayUrl: "https://relay.t3.codes",
      hostedAppUrl: "https://app.t3.codes",
    });

    expect(
      resolveT3ConnectAvailability({
        publicConfig,
        cloudConfigReady: false,
        isElectronHost: false,
      }),
    ).toEqual({
      kind: "desktop-or-hosted-required",
      relayUrl: "https://relay.t3.codes",
      hostedAppUrl: "https://app.t3.codes",
    });

    const missing = resolveT3ConnectAvailability({
      publicConfig: {
        ...publicConfig,
        relayUrl: null,
      },
      cloudConfigReady: false,
      isElectronHost: true,
    });
    expect(missing.kind).toBe("unconfigured");
    if (missing.kind === "unconfigured") {
      expect(missing.missingKeys).toContain("T3CODE_RELAY_URL");
    }
  });

  it("resolves T3 Connect relay status, hosted remote URL, QR value, and managed tunnel origin", () => {
    expect(
      resolveT3ConnectTunnelOriginUrl({
        tunnelHostname: "fish-workstation.tunnel.t3.codes",
      }),
    ).toBe("https://fish-workstation.tunnel.t3.codes");

    expect(
      resolveT3ConnectTunnelOriginUrl({
        relayEndpoint: {
          providerKind: "manual",
          httpBaseUrl: "http://192.168.1.5:3773",
          wsBaseUrl: "ws://192.168.1.5:3773",
        },
      }),
    ).toBeNull();

    const online = resolveT3ConnectRemoteAccess({
      managedTunnelActive: true,
      linkRevoked: false,
      linkState: {
        linked: true,
        cloudUserId: "user_123",
        relayUrl: "https://relay.t3.codes",
        relayIssuer: "https://relay.t3.codes",
        managedTunnelActive: true,
        publishAgentActivity: true,
        tunnelHostname: "fish-box.relay.t3.codes",
        reachability: {
          status: "reachable",
          checkedAt: "2026-11-24T00:00:00.000Z",
          readyConnections: 2,
          protocol: "quic",
        },
      },
      configuredRelayUrl: "https://relay.t3.codes",
    });
    expect(online).toEqual({
      status: "online",
      remoteWebUrl: "https://app.t3.codes",
      tunnelOriginUrl: "https://fish-box.relay.t3.codes",
      qrUrl: "https://app.t3.codes",
      relayUrl: "https://relay.t3.codes",
    });

    const revoked = resolveT3ConnectRemoteAccess({
      managedTunnelActive: false,
      linkRevoked: true,
      linkState: null,
      configuredRelayUrl: "https://relay.t3.codes",
    });
    expect(revoked.status).toBe("revoked");
    expect(revoked.tunnelOriginUrl).toBeNull();
  });

  it("formats Clerk T3 Code account identity and provides high-contrast 3-state tab/pill classes", () => {
    expect(
      formatT3CodeAccountIdentity({
        fullName: "Fish Developer",
        primaryEmailAddress: { emailAddress: "fish@example.com" },
        imageUrl: "https://img.clerk.com/avatar.png",
      }),
    ).toEqual({
      displayName: "Fish Developer",
      email: "fish@example.com",
      imageUrl: "https://img.clerk.com/avatar.png",
      initials: "FD",
    });

    const activeTab = getRemoteConnectTabButtonClass(true);
    const inactiveTab = getRemoteConnectTabButtonClass(false);
    expect(activeTab).toContain("bg-primary");
    expect(activeTab).toContain("text-primary-foreground");
    expect(inactiveTab).toContain("bg-transparent");

    expect(getRemoteEndpointPillClass(true)).toContain("bg-primary");
    expect(getRemoteEndpointPillClass(false)).toContain("border-border/70");
  });

  it("renders signed-out T3 Code account login CTA inside T3ConnectAccountCard", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <T3ConnectAccountCard
          environmentId={EnvironmentId.make("env-local")}
          canReadRelay
          canManageRelay
          variant="dialog"
        />
      </TooltipProvider>,
    );

    expect(html).toContain('data-testid="t3-connect-account-card"');
    expect(html).toContain('data-t3-connect-state="signed-out"');
    expect(html).toContain('data-testid="t3-connect-sign-in-button"');
    expect(html).toContain("T3 Connect");
    expect(html).not.toContain('data-testid="t3-connect-remote-qr"');
  });

  it("renders signed-in T3 Code account profile, sign-out button, relay online badge, QR code, and remote URLs", () => {
    clerkMockState.isSignedIn = true;
    clerkMockState.user = {
      fullName: "Fish",
      primaryEmailAddress: { emailAddress: "fish@t3.codes" },
      imageUrl: null,
    };
    cloudControllerMockState.managedTunnelActive = true;
    cloudControllerMockState.linkData = {
      ...cloudControllerMockState.linkData,
      linked: true,
      cloudUserId: "user_fish",
      managedTunnelActive: true,
      tunnelHostname: "fish-box.relay.t3.codes",
      reachability: {
        status: "reachable",
        checkedAt: "2026-11-24T00:00:00.000Z",
        readyConnections: 2,
        protocol: "quic",
      },
    };

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <T3ConnectAccountCard
          environmentId={EnvironmentId.make("env-local")}
          canReadRelay
          canManageRelay
          variant="settings"
        />
      </TooltipProvider>,
    );

    expect(html).toContain('data-t3-connect-state="signed-in"');
    expect(html).toContain("Fish");
    expect(html).toContain("fish@t3.codes");
    expect(html).toContain('data-testid="t3-connect-sign-out-button"');
    expect(html).toContain('data-testid="t3-connect-remote-switch"');
    expect(html).toContain('data-relay-status="online"');
    expect(html).toContain('data-testid="t3-connect-remote-qr"');
    expect(html).toContain("<svg");
    expect(html).toContain("https://app.t3.codes");
    expect(html).toContain("https://fish-box.relay.t3.codes");
  });

  it("renders honest desktop-or-hosted guidance instead of hiding T3 Connect when running on a private HTTP browser origin", () => {
    cloudPublicConfigMock.ready = false;

    const html = renderToStaticMarkup(
      <TooltipProvider>
        <T3ConnectAccountCard
          environmentId={EnvironmentId.make("env-local")}
          variant="dialog"
        />
      </TooltipProvider>,
    );

    expect(html).toContain('data-t3-connect-state="desktop-or-hosted-required"');
    expect(html).toContain("https://relay.t3.codes");
    expect(html).toContain("https://app.t3.codes");
    expect(html).toContain("t3 connect");
  });

  it("removes the old 2-option Phone Simulator popover from sidebar quick-nav and wires all Mobile entries to the centered modal & Sharing settings", () => {
    const webSrc = path.resolve(import.meta.dirname, "../..");
    const quickNavSource = fs.readFileSync(
      path.join(webSrc, "components/sidebar/PrismuxSidebarQuickNav.tsx"),
      "utf8",
    );
    expect(quickNavSource).toContain("openPrismuxRemoteConnectDialog");
    expect(quickNavSource).not.toContain("Built-in Phone Simulator");
    expect(quickNavSource).not.toContain("prismux-mobile-open-simulator");
    expect(quickNavSource).not.toContain("prismux-mobile-open-lan-qr");

    const sidebarChromeSource = fs.readFileSync(
      path.join(webSrc, "components/sidebar/SidebarChrome.tsx"),
      "utf8",
    );
    expect(sidebarChromeSource).toContain("openPrismuxRemoteConnectDialog()");

    const traySyncSource = fs.readFileSync(
      path.join(webSrc, "prismux/usePrismuxTraySync.ts"),
      "utf8",
    );
    expect(traySyncSource).toContain("openPrismuxRemoteConnectDialog()");

    const connectionsSource = fs.readFileSync(
      path.join(webSrc, "components/settings/ConnectionsSettings.tsx"),
      "utf8",
    );
    expect(connectionsSource).toContain("<CloudLinkRow");
    expect(connectionsSource).toContain("<ConnectDeviceApprovalSettings");
  });
});
