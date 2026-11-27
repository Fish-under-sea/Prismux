import { ProviderDriverKind } from "@prismux/core-contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatProviderUpdateRequiredNotice,
  providerUpdateChannelLags,
} from "./providerUpdateRequiredModels.ts";

describe("formatProviderUpdateRequiredNotice", () => {
  it("does not ask for an update the install's own channel cannot deliver", () => {
    const homebrewClaude = {
      driver: ProviderDriverKind.make("claudeAgent"),
      updateRequiredModels: [
        { slug: "claude-fable-5-2", name: "Claude Fable 5.2", minVersion: "2.1.321" },
      ],
      versionAdvisory: {
        status: "current" as const,
        currentVersion: "2.1.311",
        latestVersion: "2.1.311",
        updateCommand: "brew upgrade --cask claude-code",
        canUpdate: true,
        checkedAt: null,
        message: null,
      },
    };

    const notice = formatProviderUpdateRequiredNotice(homebrewClaude);

    expect(notice).toBe(
      "Using Claude Fable 5.2 requires Claude v2.1.321 or newer, but the claude-code Homebrew cask only has v2.1.311. Switch to the claude-code@latest cask: brew uninstall --cask claude-code && brew install --cask claude-code@latest",
    );
    expect(providerUpdateChannelLags(homebrewClaude)).toBe(true);
    expect(
      formatProviderUpdateRequiredNotice({
        ...homebrewClaude,
        versionAdvisory: { ...homebrewClaude.versionAdvisory, updateCommand: null },
      }),
    ).toBe(
      "Using Claude Fable 5.2 requires Claude v2.1.321 or newer, but the newest this install can update to is v2.1.311. Install Claude another way or wait for a newer release.",
    );
    expect(
      formatProviderUpdateRequiredNotice({
        ...homebrewClaude,
        versionAdvisory: { ...homebrewClaude.versionAdvisory, latestVersion: "2.1.330" },
      }),
    ).toBe("Update Claude to v2.1.321 or newer to use Claude Fable 5.2.");
    expect(
      formatProviderUpdateRequiredNotice(
        {
          ...homebrewClaude,
          versionAdvisory: { ...homebrewClaude.versionAdvisory, latestVersion: "2.1.330" },
        },
        "",
        undefined,
        "en",
        "主力 Claude",
      ),
    ).toBe("Update 主力 Claude to v2.1.321 or newer to use Claude Fable 5.2.");
    expect(
      formatProviderUpdateRequiredNotice({
        driver: ProviderDriverKind.make("codex"),
        displayName: "企业 Codex",
        updateRequiredModels: [{ slug: "gpt-6", name: "GPT-6", minVersion: "1.0.0" }],
        versionAdvisory: {
          status: "behind_latest" as const,
          currentVersion: "0.9.0",
          latestVersion: "1.1.0",
          updateCommand: null,
          canUpdate: true,
          checkedAt: null,
          message: null,
        },
      }),
    ).toBe("Update 企业 Codex to v1.0.0 or newer to use GPT-6.");
    expect(
      providerUpdateChannelLags({
        ...homebrewClaude,
        versionAdvisory: { ...homebrewClaude.versionAdvisory, latestVersion: "2.1.330" },
      }),
    ).toBe(false);
  });
});
