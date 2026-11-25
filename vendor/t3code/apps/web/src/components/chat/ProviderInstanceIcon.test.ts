import { ProviderDriverKind } from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DSH_BRAND_COLOR, DSH_FISH_LOGO_VIEWBOX } from "../../prismux/agentBrand";
import {
  isDshProviderInstance,
  ProviderInstanceIcon,
  providerLogoColor,
  resolveProviderInstanceAcpRegistryIconUrl,
} from "./ProviderInstanceIcon";

describe("resolveProviderInstanceAcpRegistryIconUrl", () => {
  it("uses allowlisted catalog metadata and rejects untrusted overrides", () => {
    expect(
      resolveProviderInstanceAcpRegistryIconUrl({
        driverKind: ProviderDriverKind.make("acpRegistry"),
        agentId: "kilo",
        iconUrl: "https://cdn.agentclientprotocol.com/registry/icons/kilo.svg",
      }),
    ).toBe("https://cdn.agentclientprotocol.com/registry/icons/kilo.svg");
    expect(
      resolveProviderInstanceAcpRegistryIconUrl({
        driverKind: ProviderDriverKind.make("acpRegistry"),
        agentId: "generic-agent",
        iconUrl: "https://example.com/not-official.svg",
      }),
    ).toBe("https://cdn.agentclientprotocol.com/registry/v1/latest/generic-agent.svg");
  });

  it("detects and renders DeepSeek Harness (dsh) whale SVG for native and local acpRegistry instances", () => {
    expect(providerLogoColor(ProviderDriverKind.make("dsh"))).toBe(DSH_BRAND_COLOR);
    expect(
      isDshProviderInstance({
        driverKind: "dsh",
        displayName: "DeepSeek Harness",
      }),
    ).toBe(true);
    expect(
      isDshProviderInstance({
        driverKind: "acpRegistry",
        displayName: "My Local Agent",
        acpRegistryAgentId: "dsh",
      }),
    ).toBe(true);
    expect(
      isDshProviderInstance({
        driverKind: "acpRegistry",
        displayName: "DeepSeek Internal",
        instanceId: "acpRegistry:team",
      }),
    ).toBe(false);

    const acpDshHtml = renderToStaticMarkup(
      createElement(ProviderInstanceIcon, {
        driverKind: ProviderDriverKind.make("acpRegistry"),
        displayName: "我的本地模型",
        acpRegistryAgentId: "dsh",
        instanceId: "acpRegistry:dsh",
      }),
    );
    expect(acpDshHtml).toContain('data-dsh-brand-icon="true"');
    expect(acpDshHtml).toContain(`viewBox="${DSH_FISH_LOGO_VIEWBOX}"`);
    expect(acpDshHtml).toContain(`fill="${DSH_BRAND_COLOR}"`);
  });
});
