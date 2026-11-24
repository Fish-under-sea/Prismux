// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("gt-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("gt-react")>();
  return {
    ...actual,
    useGT: () => (text: string) => text,
    useMessages: () => (entry: unknown) => (typeof entry === "string" ? entry : ""),
  };
});

vi.mock("../../env", () => ({
  isElectron: true,
}));

vi.mock("../../cloud/publicConfig", () => ({
  hasCloudPublicConfig: () => false,
  resolveCloudPublicConfig: () => ({
    clerkPublishableKey: "pk_live_Y2xlcmsudDMuY29kZXMk",
    clerkJwtTemplate: "t3-relay",
    relayUrl: "https://relay.t3.codes",
    relayTracing: { tracesUrl: null, tracesDataset: null, tracesToken: null },
  }),
  resolveRelayClerkTokenOptions: () => ({ template: "t3-relay" }),
  resolveRelayTracingConfig: () => null,
  setT3ConnectOptIn: vi.fn(),
}));

import { TooltipProvider } from "../ui/tooltip";
import { T3ConnectAccountCard } from "./T3ConnectAccountCard";

describe("Prismux T3 Connect privacy-first opt-in and Clerk hardening", () => {
  it("renders opt-in-required CTA in Electron when T3 Connect has not been explicitly enabled", () => {
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
    expect(html).toContain('data-t3-connect-state="opt-in-required"');
    expect(html).toContain('data-testid="t3-connect-enable-opt-in-button"');
    expect(html).not.toContain('data-testid="t3-connect-sign-in-button"');
  });

  it("forces telemetry={false} on ClerkProvider in both Electron and Browser auth shells", () => {
    const webSrc = path.resolve(import.meta.dirname, "../..");
    const electronShell = fs.readFileSync(
      path.join(webSrc, "components/clerk/ElectronManagedAuthShell.tsx"),
      "utf8",
    );
    const browserShell = fs.readFileSync(
      path.join(webSrc, "components/clerk/BrowserManagedAuthShell.tsx"),
      "utf8",
    );

    expect(electronShell).toContain("telemetry={false}");
    expect(browserShell).toContain("telemetry={false}");
  });
});
