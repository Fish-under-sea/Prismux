// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  getPrismuxRemoteConnectCopy,
  getRemoteEndpointPillClass,
  openPrismuxRemoteConnectDialog,
  subscribePrismuxRemoteConnectDialog,
} from "./prismuxRemoteConnect.logic";

describe("prismuxRemoteConnect pure QR remote access", () => {
  it("notifies dialog listeners cleanly via pub/sub without T3 Connect tabs", () => {
    const received: Array<{ readonly tab?: string }> = [];
    const unsubscribe = subscribePrismuxRemoteConnectDialog((options) => {
      received.push(options);
    });

    openPrismuxRemoteConnectDialog();
    openPrismuxRemoteConnectDialog({ tab: "mobile-web" });
    unsubscribe();
    openPrismuxRemoteConnectDialog();

    expect(received).toEqual([{}, { tab: "mobile-web" }]);
  });

  it("exposes localized pure-QR copy without T3 Connect account prompts", () => {
    const zh = getPrismuxRemoteConnectCopy("zh-CN");
    const en = getPrismuxRemoteConnectCopy("en-US");

    expect(zh.dialogTitle).toBe("扫码远控");
    expect(zh.dialogDescription).toContain("二维码");
    expect(zh.dialogDescription).not.toContain("T3 Connect");
    expect(zh.openSharingSettings).toContain("环境与扫码远控");

    expect(en.dialogTitle).toBe("QR Remote Access");
    expect(en.dialogDescription).not.toContain("T3 Connect");
    expect(en.openSharingSettings).toBe("Environments & remote access");
  });

  it("provides high-contrast active/inactive classes for LAN & Tailscale endpoint pills", () => {
    const active = getRemoteEndpointPillClass(true);
    const inactive = getRemoteEndpointPillClass(false);

    expect(active).toContain("bg-primary");
    expect(active).toContain("text-primary-foreground");
    expect(inactive).not.toContain("bg-primary");
    expect(inactive).toContain("border-border");
  });

  it("keeps remote connect, connections settings, and sidebar completely free of T3 Connect / Clerk account sign-in UI", () => {
    const dialogSource = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "PrismuxRemoteConnectDialog.tsx"),
      "utf8",
    );
    expect(dialogSource).toContain("QRCodeSvg");
    expect(dialogSource).toContain("createPairingCredential");
    expect(dialogSource).toContain('to: "/settings/connections"');
    expect(dialogSource).not.toContain("T3ConnectAccountCard");
    expect(dialogSource).not.toContain("remote-connect-tab-t3-connect");
    expect(dialogSource).not.toContain("T3 Connect");

    const connectionsSource = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "../settings/ConnectionsSettings.tsx"),
      "utf8",
    );
    expect(connectionsSource).toContain('id="remote-access"');
    expect(connectionsSource).toContain('id="mobile-qr-pairing"');
    expect(connectionsSource).toContain("openPrismuxRemoteConnectDialog");
    expect(connectionsSource).not.toContain("CloudLinkRow");
    expect(connectionsSource).not.toContain("CloudRemoteEnvironmentRows");
    expect(connectionsSource).not.toContain("RemoveT3ConnectEnvironmentDialog");
    expect(connectionsSource).not.toContain("ConnectDeviceApprovalSettings");
    expect(connectionsSource).not.toContain("RevokeConnectDeviceDialog");

    const savedRowsSource = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "../settings/SavedEnvironmentRows.tsx"),
      "utf8",
    );
    expect(savedRowsSource).not.toContain("T3ConnectAccountCard");
    expect(savedRowsSource).not.toContain("T3 Connect");
    expect(savedRowsSource).toContain("claude mcp add --transport http prismux");

    const sidebarNavSource = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "../settings/SettingsSidebarNav.tsx"),
      "utf8",
    );
    expect(sidebarNavSource).not.toContain("T3ConnectSidebarSignIn");
    expect(sidebarNavSource).not.toContain("T3ConnectSidebarAvatar");

    const installCommandsSource = NodeFS.readFileSync(
      NodePath.resolve(import.meta.dirname, "../InstallT3Commands.tsx"),
      "utf8",
    );
    expect(installCommandsSource).not.toContain("t3.codes");
    expect(installCommandsSource).toContain("prismux");

    expect(
      NodeFS.existsSync(NodePath.resolve(import.meta.dirname, "../clerk/T3ConnectSidebarSignIn.tsx")),
    ).toBe(false);
    expect(
      NodeFS.existsSync(NodePath.resolve(import.meta.dirname, "../clerk/T3ChatUserProfilePage.tsx")),
    ).toBe(false);
    expect(NodeFS.existsSync(NodePath.resolve(import.meta.dirname, "T3ConnectAccountCard.tsx"))).toBe(
      false,
    );
  });
});
