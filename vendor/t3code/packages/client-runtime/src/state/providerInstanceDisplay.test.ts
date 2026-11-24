import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  containsUuidNoise,
  disambiguateProviderInstanceDisplayNames,
  normalizeProviderAccentColor,
  providerAccentForegroundColor,
  providerInstanceInitials,
  resolveProviderInstanceDisplayName,
  shouldShowInstanceBadge,
  stripUuidNoise,
} from "./providerInstanceDisplay.ts";

const codex = ProviderDriverKind.make("codex");
const acpRegistry = ProviderDriverKind.make("acpRegistry");

describe("providerInstanceInitials", () => {
  it("treats punctuation and camel-case humps as word breaks but keeps apostrophes between letters", () => {
    expect(providerInstanceInitials("Codex (hub)")).toBe("CH");
    expect(providerInstanceInitials("work_codex")).toBe("WC");
    expect(providerInstanceInitials("Theo's Codex")).toBe("TC");
    expect(providerInstanceInitials("Codex 'hub'")).toBe("CH");
    expect(providerInstanceInitials("‘hub’")).toBe("HU");
    expect(providerInstanceInitials("(hub)")).toBe("HU");
    expect(providerInstanceInitials("ClaudeProx")).toBe("CP");
    expect(providerInstanceInitials("ClaudeAPI")).toBe("CA");
    expect(providerInstanceInitials("API")).toBe("AP");
    expect(providerInstanceInitials("ClaudeProx Work")).toBe("CW");
    expect(providerInstanceInitials("(ClaudeProx)")).toBe("CP");
  });

  it("keeps an emoji whole instead of splitting its surrogate pair", () => {
    expect(providerInstanceInitials("😀 Work")).toBe("😀W");
    expect(providerInstanceInitials("😀")).toBe("😀");
  });
});

describe("normalizeProviderAccentColor", () => {
  // regression: #9899 a non-hex accent must not render as the account badge color
  it("rejects a non-hex value", () => {
    expect(normalizeProviderAccentColor("blue")).toBeUndefined();
  });
});

describe("providerAccentForegroundColor", () => {
  it.each([
    ["#b5f23d", "#000000"],
    ["#2563eb", "#ffffff"],
    ["#777777", "#000000"],
  ])("chooses the higher WCAG contrast foreground for %s", (accent, foreground) => {
    expect(providerAccentForegroundColor(accent)).toBe(foreground);
  });
});

describe("shouldShowInstanceBadge", () => {
  it("hides badges for distinct ACP agents sharing the registry driver", () => {
    const mistral = { driverKind: acpRegistry, acpRegistryAgentId: "mistral-vibe", enabled: true };
    const devin = { driverKind: acpRegistry, acpRegistryAgentId: "devin", enabled: true };
    expect(shouldShowInstanceBadge(mistral, [mistral, devin])).toBe(false);
    expect(shouldShowInstanceBadge(devin, [mistral, devin])).toBe(false);
  });

  it("distinguishes registry instances whose agent identity is unavailable", () => {
    const entry = { driverKind: acpRegistry, enabled: true };
    expect(shouldShowInstanceBadge(entry, [entry, { ...entry }])).toBe(true);
  });

  it("shows the badge when the entry has an accent color", () => {
    const entry = { driverKind: codex, accentColor: "#ff8800", enabled: true };
    expect(shouldShowInstanceBadge(entry, [entry])).toBe(true);
  });

  it("ignores a non-hex accent color", () => {
    const entry = { driverKind: codex, accentColor: "blue", enabled: true };
    expect(shouldShowInstanceBadge(entry, [entry])).toBe(false);
  });

  it("shows the badge when two entries share a driver, even without an accent", () => {
    const first = { driverKind: codex, accentColor: undefined, enabled: true };
    const second = { driverKind: codex, accentColor: undefined, enabled: true };
    expect(shouldShowInstanceBadge(first, [first, second])).toBe(true);
  });

  it("ignores disabled siblings for enabled instances while distinguishing historical owners", () => {
    const enabled = { driverKind: codex, enabled: true };
    const disabled = { driverKind: codex, enabled: false };

    expect(shouldShowInstanceBadge(enabled, [enabled, disabled])).toBe(false);
    expect(shouldShowInstanceBadge(disabled, [enabled, disabled])).toBe(true);
    expect(shouldShowInstanceBadge(disabled, [disabled, { ...disabled }])).toBe(true);
    expect(shouldShowInstanceBadge(disabled, [disabled])).toBe(false);
  });
});

describe("resolveProviderInstanceDisplayName & UUID noise scrubbing", () => {
  it("never leaks UUID instanceId when a UUID-keyed instance is renamed to its brand name or left unnamed", () => {
    const uuidId = ProviderInstanceId.make("codex_048c43c3-0798-480e-bc42-1a2b3c4d5e6f");

    // Exact regression from preview.4 screenshot: renaming codex_<uuid> to "Codex" previously fell through to humanizeSlug(instanceId)
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: uuidId,
        driver: codex,
        displayName: "Codex",
      }),
    ).toBe("Codex");

    // Empty/unset displayName on a UUID instance must fall back cleanly to the brand label, never UUID tokens
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: uuidId,
        driver: codex,
        displayName: undefined,
      }),
    ).toBe("Codex");

    // Custom human rename is preserved verbatim
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: uuidId,
        driver: codex,
        displayName: "主力 Codex",
      }),
    ).toBe("主力 Codex");

    // Pre-corrupted UUID display strings are automatically scrubbed
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: uuidId,
        driver: codex,
        displayName: "Codex 048c43c3 0798 480e Bc42 1...",
      }),
    ).toBe("Codex");

    // Meaningful non-UUID human slugs still humanize cleanly when unnamed
    expect(
      resolveProviderInstanceDisplayName({
        instanceId: ProviderInstanceId.make("codex_work"),
        driver: codex,
        displayName: undefined,
      }),
    ).toBe("Codex Work");
  });

  it("detects and strips full, partial, humanized, and compact UUID fragments without harming normal labels", () => {
    expect(containsUuidNoise("codex_048c43c3-0798-480e-bc42-1a2b3c4d5e6f")).toBe(true);
    expect(containsUuidNoise("Codex 048c43c3 0798 480e Bc42 1...")).toBe(true);
    expect(containsUuidNoise("codex-048c43c30798480ebc421a2b3c4d5e6f")).toBe(true);
    expect(containsUuidNoise("Codex")).toBe(false);
    expect(containsUuidNoise("Codex (2)")).toBe(false);
    expect(containsUuidNoise("GPT-5.4 Turbo")).toBe(false);

    expect(stripUuidNoise("Codex 048c43c3 0798 480e Bc42 1...")).toBe("Codex");
    expect(stripUuidNoise("codex_048c43c3-0798-480e-bc42-1a2b3c4d5e6f")).toBe("codex");
    expect(stripUuidNoise("048c43c3-0798-480e-bc42-1a2b3c4d5e6f")).toBe("");
  });

  it("disambiguates multiple unnamed same-driver instances with minimal numbering (Codex, Codex (2)) without UUIDs", () => {
    const disambiguated = disambiguateProviderInstanceDisplayNames([
      {
        instanceId: "codex",
        driverKind: codex,
        displayName: "Codex",
        isDefault: true,
        enabled: true,
        hasCustomDisplayName: false,
      },
      {
        instanceId: "codex_048c43c3-0798-480e-bc42-1a2b3c4d5e6f",
        driverKind: codex,
        displayName: "Codex",
        isDefault: false,
        enabled: true,
        hasCustomDisplayName: false,
      },
      {
        instanceId: "codex_99999999-1111-2222-3333-444444444444",
        driverKind: codex,
        displayName: "Codex",
        isDefault: false,
        enabled: true,
        hasCustomDisplayName: false,
      },
    ]);

    expect(disambiguated.map((item) => item.displayName)).toEqual([
      "Codex",
      "Codex (2)",
      "Codex (3)",
    ]);
  });
});
