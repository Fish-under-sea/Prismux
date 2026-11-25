import { describe, expect, it, vi } from "vite-plus/test";

import {
  buildContinueInTerminalCommand,
  DSH_LOCAL_ACP_PRESET,
  openSafeExternalHttpsFromAnchor,
  PRISMUX_AGENT_CLI_CATALOG,
  resolveAgentCliMeta,
  resolveAgentCliProcessFamily,
  resolveSafeAgentHomepageUrl,
  sanitizeResumeSessionId,
  supportsDualLaunchMode,
  validateSafeHttpsUrl,
} from "./prismuxProviderMeta";

describe("validateSafeHttpsUrl", () => {
  it("accepts valid https URLs and preserves canonical form", () => {
    expect(validateSafeHttpsUrl("https://opencode.ai")).toBe("https://opencode.ai/");
    expect(validateSafeHttpsUrl("  https://docs.anthropic.com/en/docs/claude-code/overview  ")).toBe(
      "https://docs.anthropic.com/en/docs/claude-code/overview",
    );
    expect(validateSafeHttpsUrl("https://github.com/openai/codex?tab=readme#install")).toBe(
      "https://github.com/openai/codex?tab=readme#install",
    );
  });

  it("rejects non-https schemes, control characters, and malformed URLs", () => {
    const rejected = [
      null,
      undefined,
      "",
      "   ",
      "http://opencode.ai",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///C:/Windows/System32/cmd.exe",
      "vbscript:msgbox(1)",
      "https://opencode.ai/\nmalicious",
      "https://opencode.ai/\u0000null",
      "not a url",
      "opencode.ai",
    ];
    for (const candidate of rejected) {
      expect(validateSafeHttpsUrl(candidate), String(candidate)).toBeNull();
    }
  });
});

describe("DSH local ACP preset & official Agent catalog", () => {
  it("defines the one-click dsh local ACP preset with validated https homepage", () => {
    expect(DSH_LOCAL_ACP_PRESET).toMatchObject({
      id: "dsh",
      command: "dsh",
      args: ["acp"],
      homepageUrl: "https://github.com/deepseek-ai/deepseek-harness",
    });
    expect("accentColor" in DSH_LOCAL_ACP_PRESET).toBe(false);
    expect(validateSafeHttpsUrl(DSH_LOCAL_ACP_PRESET.homepageUrl)).toBe(
      "https://github.com/deepseek-ai/deepseek-harness",
    );
    const meta = resolveAgentCliMeta({
      driver: "acpRegistry",
      instanceId: "dsh",
      config: { source: "local", commandPath: "dsh", commandArgs: ["acp"] },
    });
    expect(meta?.id).toBe("dsh");
    expect(meta?.cliCommand).toBe("dsh");
  });

  it("keeps every built-in agent homepageUrl strictly valid https, excludes removed omp/fx presets, and supports pi", () => {
    expect("omp" in PRISMUX_AGENT_CLI_CATALOG).toBe(false);
    expect("fx" in PRISMUX_AGENT_CLI_CATALOG).toBe(false);
    expect("pi" in PRISMUX_AGENT_CLI_CATALOG).toBe(true);
    expect(supportsDualLaunchMode({ driver: "pi" })).toBe(true);
    expect(resolveAgentCliMeta({ driver: "pi" })?.cliCommand).toBe("pi");
    const fallbackOmp = resolveAgentCliMeta({
      driver: "acpRegistry",
      instanceId: "omp",
      config: { source: "local", commandPath: "omp", commandArgs: ["acp"] },
    });
    expect(fallbackOmp).not.toBeNull();
    expect(fallbackOmp?.homepageUrl).toBe("");
    expect(fallbackOmp?.updateCommandHint).toBe("");
    expect(fallbackOmp?.supportsResume).toBe(false);
    for (const [key, meta] of Object.entries(PRISMUX_AGENT_CLI_CATALOG)) {
      expect(validateSafeHttpsUrl(meta.homepageUrl), key).not.toBeNull();
      expect(meta.updateCommandHint.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("guides unauthenticated Antigravity strictly through official agy acp --login", () => {
    const agy = resolveAgentCliMeta({ driver: "antigravity" });
    expect(agy).not.toBeNull();
    expect(agy?.cliCommand).toBe("agy");
    expect(agy?.loginHint).toBe("agy acp --login");
    expect(agy?.homepageUrl).toBe("https://antigravity.google/");
  });

  it("resolves dsh metadata when configured as a local acpRegistry instance", () => {
    const meta = resolveAgentCliMeta({
      driver: "acpRegistry",
      instanceId: "dsh",
      config: { source: "local", commandPath: "C:\\Users\\Fish\\bin\\dsh.exe", args: ["acp"] },
    });
    expect(meta?.id).toBe("dsh");
    expect(meta?.homepageUrl).toBe("https://github.com/deepseek-ai/deepseek-harness");
    expect(
      resolveSafeAgentHomepageUrl({
        driver: "acpRegistry",
        instanceId: "dsh",
        websiteUrl: "javascript:alert(1)",
        config: { source: "local", commandPath: "dsh" },
      }),
    ).toBe("https://github.com/deepseek-ai/deepseek-harness");
  });

  it("distinguishes dual-mode capable providers from unsupported ones", () => {
    expect(supportsDualLaunchMode({ driver: "claudeAgent" })).toBe(true);
    expect(supportsDualLaunchMode({ driver: "codex" })).toBe(true);
    expect(supportsDualLaunchMode({ driver: "antigravity" })).toBe(true);
    expect(
      supportsDualLaunchMode({
        driver: "acpRegistry",
        config: { source: "local", commandPath: "dsh" },
      }),
    ).toBe(true);
    expect(supportsDualLaunchMode({ driver: "acpRegistry", config: { source: "registry" } })).toBe(
      false,
    );
    expect(supportsDualLaunchMode({ driver: "unknown-api-only" })).toBe(false);
  });
});

describe("buildContinueInTerminalCommand", () => {
  it("appends resume flags for CLIs that support session resume", () => {
    expect(
      buildContinueInTerminalCommand({
        driver: "claudeAgent",
        sessionId: "sess_abc123",
      }),
    ).toMatchObject({
      command: "claude --resume sess_abc123",
      supportsResume: true,
    });

    expect(
      buildContinueInTerminalCommand({
        driver: "codex",
        sessionId: "thread-987",
      }),
    ).toMatchObject({
      command: "codex resume thread-987",
      supportsResume: true,
    });

    expect(
      buildContinueInTerminalCommand({
        driver: "acpRegistry",
        instanceId: "opencode",
        config: { source: "local", commandPath: "opencode" },
        sessionId: "oc-session-42",
      }),
    ).toMatchObject({
      command: "opencode --session oc-session-42",
      supportsResume: true,
    });
  });

  it("rejects shell injection characters in session IDs", () => {
    expect(sanitizeResumeSessionId("safe_id-123.abc:1")).toBe("safe_id-123.abc:1");
    expect(sanitizeResumeSessionId("abc; rm -rf /")).toBeNull();
    expect(sanitizeResumeSessionId("$(whoami)")).toBeNull();

    const built = buildContinueInTerminalCommand({
      driver: "codex",
      sessionId: "bad;whoami",
    });
    expect(built.command).toBe("codex");
    expect(built.supportsResume).toBe(false);
  });

  it("uses PowerShell call syntax without backslash escaping for Windows binary paths containing spaces", () => {
    const built = buildContinueInTerminalCommand({
      driver: "codex",
      binaryPath: "C:\\Program Files\\OpenAI Tools\\codex.cmd",
      sessionId: "thread-987",
    });
    expect(built.command).toBe("& 'C:\\Program Files\\OpenAI Tools\\codex.cmd' resume thread-987");
    expect(built.supportsResume).toBe(true);
  });
});

describe("openSafeExternalHttpsFromAnchor & process-family resolution (Orca alignment)", () => {
  it("routes plain left-click https anchors via desktopBridge while preserving modifier clicks", () => {
    const openExternal = vi.fn();
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
        desktopBridge: { openExternal },
        open: vi.fn(),
      },
    });
    try {
      const preventDefaultPlain = vi.fn();
      expect(
        openSafeExternalHttpsFromAnchor({
          button: 0,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          currentTarget: { href: "https://opencode.ai/", protocol: "https:" },
          preventDefault: preventDefaultPlain,
        }),
      ).toBe(true);
      expect(preventDefaultPlain).toHaveBeenCalledTimes(1);
      expect(openExternal).toHaveBeenCalledWith("https://opencode.ai/");

      // Modifier clicks (Cmd/Ctrl/Shift) and middle-clicks must preserve native behavior.
      const preventDefaultCtrl = vi.fn();
      expect(
        openSafeExternalHttpsFromAnchor({
          button: 0,
          metaKey: false,
          ctrlKey: true,
          shiftKey: false,
          altKey: false,
          currentTarget: { href: "https://opencode.ai/", protocol: "https:" },
          preventDefault: preventDefaultCtrl,
        }),
      ).toBe(false);
      expect(preventDefaultCtrl).not.toHaveBeenCalled();

      // Unsafe http: or javascript: links are blocked even on plain left click.
      const preventDefaultUnsafe = vi.fn();
      expect(
        openSafeExternalHttpsFromAnchor({
          button: 0,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          currentTarget: { href: "http://opencode.ai/", protocol: "http:" },
          preventDefault: preventDefaultUnsafe,
        }),
      ).toBe(false);
      expect(preventDefaultUnsafe).toHaveBeenCalledTimes(1);
      expect(openExternal).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: originalWindow,
      });
    }
  });

  it("maps aliases sharing one CLI executable into the same process family", () => {
    expect(resolveAgentCliProcessFamily({ driver: "claudeAgent" })).toBe("claude");
    expect(resolveAgentCliProcessFamily({ driver: "claude" })).toBe("claude");
    expect(resolveAgentCliProcessFamily({ driver: "antigravity" })).toBe("agy");
    expect(resolveAgentCliProcessFamily({ driver: "agy" })).toBe("agy");
    expect(
      resolveAgentCliProcessFamily({
        driver: "acpRegistry",
        instanceId: "dsh",
        config: { source: "local", commandPath: "dsh" },
      }),
    ).toBe("dsh");
  });
});
