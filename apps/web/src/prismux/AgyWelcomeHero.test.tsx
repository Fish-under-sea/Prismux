import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  AgyWelcomeGreeting,
  resolveCurrentUserDisplayName,
} from "./AgyWelcomeHero";

describe("AgyWelcomeHero real OS username priority (Section 17)", () => {
  it("prioritizes explicit serverConfig.osUsername over desktopBridge, explicitName, and path heuristics", () => {
    const prevWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {
      desktopBridge: {
        osUsername: "BridgeUser",
        getOsUsername: () => "GetterUser",
      },
    };
    try {
      expect(
        resolveCurrentUserDisplayName({
          osUsername: "  Fish  ",
          explicitName: "FallbackName",
          keybindingsConfigPath: "C:\\Users\\OtherUser\\.t3\\keybindings.json",
          cwd: "D:\\workspace\\Prismux",
        }),
      ).toBe("Fish");
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  });

  it("falls back to window.desktopBridge.osUsername then getOsUsername() when serverConfig omits osUsername", () => {
    const prevWindow = (globalThis as Record<string, unknown>).window;
    try {
      (globalThis as Record<string, unknown>).window = {
        desktopBridge: {
          osUsername: "FishDesktop",
          getOsUsername: () => "ShouldNotUse",
        },
      };
      expect(
        resolveCurrentUserDisplayName({
          osUsername: "   ",
          cwd: "D:\\Fish-code\\AGY\\Prismux",
        }),
      ).toBe("FishDesktop");

      const getOsUsername = vi.fn(() => "FishPreload");
      (globalThis as Record<string, unknown>).window = {
        desktopBridge: {
          osUsername: null,
          getOsUsername,
        },
      };
      expect(
        resolveCurrentUserDisplayName({
          cwd: "D:\\Fish-code\\AGY\\Prismux",
        }),
      ).toBe("FishPreload");
      expect(getOsUsername).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }
  });

  it("falls back cleanly to path extraction and finally null ('User') when osUsername and bridge are unavailable", () => {
    const prevWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = {
      desktopBridge: {
        osUsername: "",
        getOsUsername: () => {
          throw new Error("bridge unavailable");
        },
      },
    };
    try {
      expect(
        resolveCurrentUserDisplayName({
          keybindingsConfigPath: "C:\\Users\\Alice\\.prismux\\keybindings.json",
          cwd: "D:\\workspace",
        }),
      ).toBe("Alice");
      expect(
        resolveCurrentUserDisplayName({
          cwd: "D:\\workspace",
        }),
      ).toBeNull();
    } finally {
      (globalThis as Record<string, unknown>).window = prevWindow;
    }

    const html = renderToStaticMarkup(
      <AgyWelcomeGreeting
        userName={resolveCurrentUserDisplayName({ osUsername: "Fish", cwd: "D:\\workspace" })}
        locale="zh"
        initialDate={new Date(2026, 5, 1, 20, 0)}
        rng={() => 0.5}
      />,
    );
    expect(html).toContain("Fish");
  });
});
