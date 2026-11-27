import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_KEYBINDINGS, DEFAULT_RESOLVED_KEYBINDINGS } from "./keybindings.ts";

describe("DEFAULT_KEYBINDINGS", () => {
  it("registers dual composer.sendAlternate defaults with mod+enter taking primary precedence over shift+enter", () => {
    const rules = DEFAULT_KEYBINDINGS.filter((rule) => rule.command === "composer.sendAlternate");
    expect(rules).toEqual([
      {
        key: "shift+enter",
        command: "composer.sendAlternate",
        when: "composerFocus && turnRunning",
      },
      {
        key: "mod+enter",
        command: "composer.sendAlternate",
        when: "composerFocus && turnRunning",
      },
    ]);
  });

  it("registers chat.citeSelection, chat.sideAskSelection, and sidebar.collapseAllProjects without conflicting with existing defaults", () => {
    expect(DEFAULT_KEYBINDINGS).toContainEqual({
      key: "mod+l",
      command: "chat.citeSelection",
      when: "!terminalFocus && !previewFocus",
    });
    expect(DEFAULT_KEYBINDINGS).toContainEqual({
      key: "mod+e",
      command: "chat.sideAskSelection",
      when: "!terminalFocus && !previewFocus",
    });
    expect(DEFAULT_KEYBINDINGS).toContainEqual({
      key: "mod+shift+h",
      command: "sidebar.collapseAllProjects",
      when: "!terminalFocus",
    });
    expect(DEFAULT_KEYBINDINGS).toContainEqual({
      key: "mod+alt+h",
      command: "composer.host",
      when: "!terminalFocus",
    });
    expect(DEFAULT_RESOLVED_KEYBINDINGS.length).toBe(DEFAULT_KEYBINDINGS.length);
  });

  it("has no duplicate key+when pairs across DEFAULT_KEYBINDINGS", () => {
    const seen = new Set<string>();
    for (const rule of DEFAULT_KEYBINDINGS) {
      const signature = `${rule.key}\u0000${rule.when ?? ""}`;
      expect(seen.has(signature), `duplicate default key+when: ${signature}`).toBe(false);
      seen.add(signature);
    }
  });
});
