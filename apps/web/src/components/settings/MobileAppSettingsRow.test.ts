// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { MOBILE_APP_STORES, resolveMobileWebEndpoints } from "./MobileAppSettingsRow";

describe("MobileAppSettingsRow LAN / Tailscale web endpoints", () => {
  it("filters out loopback addresses and returns LAN and Tailscale web URLs", () => {
    const endpoints = resolveMobileWebEndpoints({
      exposureState: {
        mode: "network-accessible",
        endpointUrl: "http://192.168.1.42:3773/",
        advertisedHost: "192.168.1.42",
        tailscaleServeEnabled: true,
        tailscaleServePort: 443,
      },
      advertisedEndpoints: [
        {
          id: "tailscale-1",
          label: "Tailscale HTTPS",
          provider: {
            id: "tailscale-serve",
            label: "Tailscale Serve",
            kind: "private-network",
            isAddon: true,
          },
          status: "available",
          httpBaseUrl: "https://fish-pc.tailnet.ts.net/",
          wsBaseUrl: "wss://fish-pc.tailnet.ts.net/",
          reachability: "private-network",
          compatibility: {
            hostedHttpsApp: "compatible",
            desktopApp: "compatible",
          },
          source: "desktop-addon",
          isDefault: true,
        },
      ],
      directEndpoints: [
        "http://127.0.0.1:3773",
        "http://localhost:3773",
        { kind: "lan", httpBaseUrl: "http://192.168.1.42:3773" },
        { kind: "tailnet", httpBaseUrl: "https://fish-pc.tailnet.ts.net" },
      ],
    });

    expect(endpoints.map((e) => e.url)).toEqual([
      "https://fish-pc.tailnet.ts.net",
      "http://192.168.1.42:3773",
    ]);
  });

  it("hides LAN URLs when exposure mode is local-only while still allowing Tailscale HTTPS", () => {
    const endpoints = resolveMobileWebEndpoints({
      exposureState: {
        mode: "local-only",
        endpointUrl: null,
        advertisedHost: null,
        tailscaleServeEnabled: false,
        tailscaleServePort: 443,
      },
      directEndpoints: [
        { kind: "lan", httpBaseUrl: "http://192.168.1.42:3773" },
        { kind: "tailnet", httpBaseUrl: "https://fish-pc.tailnet.ts.net" },
      ],
    });

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]).toMatchObject({
      url: "https://fish-pc.tailnet.ts.net",
      kind: "tailscale",
    });
  });

  it("preserves both LAN/Tailscale QR access and iPhone/Android mobile app download links while keeping /settings/about free of T3 Code copy", () => {
    expect(MOBILE_APP_STORES.map((entry) => entry.store)).toEqual(["App Store", "Google Play"]);

    const filePath = path.resolve(import.meta.dirname, "MobileAppSettingsRow.tsx");
    const source = fs.readFileSync(filePath, "utf8");
    expect(source).toContain("MOBILE_APP_STORES");
    expect(source).toContain("Scan to open Prismux Web");
    expect(source).not.toContain("T3 Code");

    const cliCmdSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "CliCommandSettingsRow.tsx"),
      "utf8",
    );
    expect(cliCmdSource).not.toContain("T3 Code");

    const aboutVersionSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "AboutVersionTitle.tsx"),
      "utf8",
    );
    expect(aboutVersionSource).not.toContain("T3 Code");

    const settingsPanelsSource = fs.readFileSync(
      path.resolve(import.meta.dirname, "SettingsPanels.tsx"),
      "utf8",
    );
    const aboutStart = settingsPanelsSource.indexOf("export function AboutSettingsPanel()");
    expect(aboutStart).toBeGreaterThan(-1);
    const aboutSource = settingsPanelsSource.slice(aboutStart);
    expect(aboutSource).toContain("<PrismuxUpdatesSettingsPage embedded />");
    expect(aboutSource).not.toContain("T3 Code");
  });
});
