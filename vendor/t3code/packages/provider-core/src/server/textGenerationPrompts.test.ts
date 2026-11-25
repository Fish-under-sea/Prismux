import { describe, expect, it } from "vite-plus/test";

import { buildThreadTitlePrompt } from "./textGenerationPrompts.ts";
import { normalizeCliError } from "./textGenerationUtils.ts";

describe("normalizeCliError", () => {
  it("does not expose CLI failure details in the public error message", () => {
    const result = normalizeCliError(
      "codex",
      "generateCommitMessage",
      new Error("request failed with access_token=secret-token"),
      "Failed to generate a commit message",
    );

    expect(result.detail).toBe("Failed to generate a commit message");
    expect(result.message).not.toContain("secret-token");
  });
});

describe("buildThreadTitlePrompt", () => {
  it("names the project to leave out and puts the user's instructions above the limits", () => {
    for (const previousTitle of [undefined, "Hyperdrive Config Crash"]) {
      const { prompt } = buildThreadTitlePrompt({
        message: "hyperdrive init crashes without a config",
        previousTitle,
        projectTitle: "Hyperdrive",
        instructions: "Prefix every title with the team name.",
      });
      expect(prompt).toContain('Never include the project name ("Hyperdrive")');
      expect(prompt).not.toContain("under 36 characters total");
      expect(prompt).toContain("Title instructions from the user:\nPrefix every title");
    }
    const defaultInitial = buildThreadTitlePrompt({ message: "Fix login", instructions: " " }).prompt;
    expect(defaultInitial).toContain("简体中文");
    expect(defaultInitial).toContain("6-18 Chinese characters (under 36 characters total)");
    expect(defaultInitial).toContain("GitHub, Electron, OAuth, API");
    expect(defaultInitial).toContain("trailing punctuation");
    expect(defaultInitial).toContain("Do not copy and truncate");
    expect(defaultInitial).not.toContain("Prismux");

    const defaultRegen = buildThreadTitlePrompt({
      message: "User: Fix GitHub OAuth callback\nAssistant: Updated Electron protocol handler",
      previousTitle: "Fix GitHub OAuth",
    }).prompt;
    expect(defaultRegen).toContain("简体中文");
    expect(defaultRegen).toContain("GitHub, Electron, OAuth, API");
    expect(defaultRegen).toContain("English-only");
    expect(defaultRegen).not.toContain("Prismux");
  });
});
