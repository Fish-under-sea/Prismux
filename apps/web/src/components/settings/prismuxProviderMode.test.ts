// @effect-diagnostics-next-line nodeBuiltinImport:off
import fs from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  PROVIDER_LAUNCH_MODE_STORAGE_KEY,
  readProviderLaunchModeState,
  resetProviderLaunchModeCacheForTests,
  resolveEffectiveLaunchMode,
  setGlobalDefaultLaunchMode,
  setProviderInstanceLaunchMode,
} from "./prismuxProviderMode";

describe("prismuxProviderMode Chat | CLI preference persistence", () => {
  const storageMap = new Map<string, string>();
  const originalWindow = globalThis.window;

  beforeEach(() => {
    storageMap.clear();
    resetProviderLaunchModeCacheForTests();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
        localStorage: {
          getItem: (key: string) => storageMap.get(key) ?? null,
          setItem: (key: string, value: string) => {
            storageMap.set(key, value);
          },
          removeItem: (key: string) => {
            storageMap.delete(key);
          },
        },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });
  });

  afterEach(() => {
    resetProviderLaunchModeCacheForTests();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: originalWindow,
    });
  });

  it("defaults to chat mode and persists global default changes across reloads", () => {
    expect(readProviderLaunchModeState()).toEqual({
      globalDefaultMode: "chat",
      perInstanceMode: {},
    });

    setGlobalDefaultLaunchMode("cli");
    expect(storageMap.get(PROVIDER_LAUNCH_MODE_STORAGE_KEY)).toContain('"globalDefaultMode":"cli"');

    // Simulate reload by clearing in-memory cache.
    resetProviderLaunchModeCacheForTests();
    expect(readProviderLaunchModeState().globalDefaultMode).toBe("cli");
  });

  it("persists per-provider overrides and falls back cleanly when reset to null", () => {
    setGlobalDefaultLaunchMode("chat");
    setProviderInstanceLaunchMode("claude-default", "cli");
    setProviderInstanceLaunchMode("codex-default", "chat");

    resetProviderLaunchModeCacheForTests();
    const restored = readProviderLaunchModeState();
    expect(resolveEffectiveLaunchMode(restored, "claude-default", true)).toBe("cli");
    expect(resolveEffectiveLaunchMode(restored, "codex-default", true)).toBe("chat");
    expect(resolveEffectiveLaunchMode(restored, "omp-default", true)).toBe("chat");

    setGlobalDefaultLaunchMode("cli");
    const afterGlobal = readProviderLaunchModeState();
    // Explicit per-provider override stays respected.
    expect(resolveEffectiveLaunchMode(afterGlobal, "codex-default", true)).toBe("chat");
    // Unset provider follows global default.
    expect(resolveEffectiveLaunchMode(afterGlobal, "omp-default", true)).toBe("cli");

    // Resetting per-provider override returns to global default.
    setProviderInstanceLaunchMode("codex-default", null);
    expect(resolveEffectiveLaunchMode(readProviderLaunchModeState(), "codex-default", true)).toBe(
      "cli",
    );
  });

  it("forces chat mode for providers that do not support dual Chat | CLI launch mode", () => {
    setGlobalDefaultLaunchMode("cli");
    setProviderInstanceLaunchMode("remote-acp", "cli");
    const state = readProviderLaunchModeState();
    expect(resolveEffectiveLaunchMode(state, "remote-acp", false)).toBe("chat");
  });

  it("keeps identical column-aligned width slot for both dual-mode and placeholder rows", () => {
    const cardPath = path.resolve(import.meta.dirname, "ProviderInstanceCard.tsx");
    const source = fs.readFileSync(cardPath, "utf8");
    expect(source).toContain("data-provider-mode-toggle={instanceId}");
    expect(source).toContain("data-provider-mode-placeholder={instanceId}");
    // Both active toggle and placeholder slot share the exact fixed width token `w-[5.25rem]`.
    const fixedWidthMatches = source.match(/w-\[5\.25rem\]/g) ?? [];
    expect(fixedWidthMatches.length).toBeGreaterThanOrEqual(2);
    // Aligned with stablyai/orca AgentOpensAsControl: missing CLI disables CLI button with tooltip & roving keyboard focus.
    expect(source).toContain("cliMissingForLaunchMode");
    expect(source).toContain("Install the {provider} CLI to open it in a terminal.");
    expect(source).toContain('event.key === "ArrowLeft"');
    expect(source).toContain("max-sm:hidden");
  });
});
