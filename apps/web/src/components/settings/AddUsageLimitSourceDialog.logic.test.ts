import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  type ServerSettings,
  UsageLimitSourceId,
  type UsageLimitSourceSnapshot,
} from "@prismux/core-contracts";
import { applyServerSettingsPatch } from "@prismux/core-shared/serverSettings";
import { describe, expect, it } from "vite-plus/test";

import {
  getRelayProtocolMeta,
  sourceIdFromUrl,
  summarizeUsageLimitSourceSnapshot,
} from "./AddUsageLimitSourceDialog.logic";

describe("adding usage limit sources", () => {
  it.each([
    ["https://api.example.com/relay-a", "https://api.example.com/relay-b"],
    ["localhost:3000", "localhost:4000"],
  ])("retains saved configurations for %s and %s", (firstUrl, secondUrl) => {
    let settings: ServerSettings = DEFAULT_SERVER_SETTINGS;
    const sources = [
      [firstUrl, "First relay", "first-key", "newapi"],
      [secondUrl, "Second relay", "second-key", "openaiBilling"],
      [`${secondUrl}/extra`, "Third relay", "third-key", "cliproxy"],
    ] as const;
    for (const [url, label, managementKey, kind] of sources) {
      const id = sourceIdFromUrl(url, settings.usageLimitSources, kind);
      settings = applyServerSettingsPatch(settings, {
        usageLimitSources: {
          [id]: { kind, url, label, managementKey, enabled: true },
        },
      });
    }
    expect(Object.values(settings.usageLimitSources)).toEqual(
      sources.map(([url, label, managementKey, kind]) => ({
        kind,
        url,
        label,
        managementKey,
        enabled: true,
      })),
    );
  });

  it("uses kind-specific prefixes (newapi-, relay-, cliproxy-) and falls back to relay slug", () => {
    expect(sourceIdFromUrl("https://api.example.com", {}, "newapi")).toBe(
      "newapi-api.example.com",
    );
    expect(sourceIdFromUrl("https://api.example.com", {})).toBe("newapi-api.example.com");
    expect(sourceIdFromUrl("https://api.example.com/v1", {}, "openaiBilling")).toBe(
      "relay-api.example.com",
    );
    expect(sourceIdFromUrl("https://proxy.example.com:8318", {}, "cliproxy")).toBe(
      "cliproxy-proxy.example.com-8318",
    );
    expect(sourceIdFromUrl("///", {}, "newapi")).toBe("newapi-relay");
    expect(sourceIdFromUrl("///", {}, "openaiBilling")).toBe("relay-relay");
    expect(sourceIdFromUrl("///", {}, "cliproxy")).toBe("cliproxy-relay");
  });

  it("updates a saved source when its URL is added again", () => {
    let settings: ServerSettings = DEFAULT_SERVER_SETTINGS;
    for (const managementKey of ["old-key", "new-key"]) {
      const url = "https://api.example.com/v1";
      settings = applyServerSettingsPatch(settings, {
        usageLimitSources: {
          [sourceIdFromUrl(url, settings.usageLimitSources, "newapi")]: {
            kind: "newapi",
            url,
            managementKey,
            userId: "1",
            enabled: true,
          },
        },
      });
    }
    expect(Object.values(settings.usageLimitSources)).toEqual([
      {
        kind: "newapi",
        url: "https://api.example.com/v1",
        managementKey: "new-key",
        userId: "1",
        enabled: true,
      },
    ]);
  });

  it("exposes distinct localized placeholders and optional userId visibility per protocol", () => {
    const newapiZh = getRelayProtocolMeta("newapi", "zh");
    const billingEn = getRelayProtocolMeta("openaiBilling", "en");
    const cliproxyZh = getRelayProtocolMeta("cliproxy", "zh");

    expect(newapiZh.urlPlaceholder).toBe("https://api.example.com");
    expect(newapiZh.showUserId).toBe(true);
    expect(billingEn.urlPlaceholder).toBe("https://api.example.com/v1");
    expect(billingEn.showUserId).toBe(false);
    expect(cliproxyZh.urlPlaceholder).toBe("https://proxy.example.com:8318");
    expect(cliproxyZh.urlPlaceholder).not.toContain("hub.example.ts.net");
    expect(cliproxyZh.showUserId).toBe(false);
  });

  it("summarizes live relay balance and error snapshots", () => {
    const base: Omit<UsageLimitSourceSnapshot, "accounts" | "error"> = {
      id: UsageLimitSourceId.make("newapi-api.example.com"),
      kind: "newapi",
      label: "My New API",
      checkedAt: "2026-11-26T00:00:00.000Z",
    };

    expect(
      summarizeUsageLimitSourceSnapshot(
        {
          ...base,
          accounts: [
            {
              id: "1",
              driver: ProviderDriverKind.make("openaiCompatible"),
              usageLimits: {
                checkedAt: base.checkedAt,
                windows: [
                  {
                    id: "relay-balance",
                    kind: "monthly",
                    label: "$12.50 left · $7.50 / $20.00",
                    usedPercent: 37.5,
                  },
                ],
              },
            },
          ],
        },
        "zh",
      ),
    ).toEqual({
      tone: "success",
      text: "$12.50 left · $7.50 / $20.00",
    });

    expect(
      summarizeUsageLimitSourceSnapshot(
        { ...base, accounts: [], error: "The relay answered with HTTP 401." },
        "zh",
      ),
    ).toEqual({
      tone: "error",
      text: "The relay answered with HTTP 401.",
    });
  });
});
