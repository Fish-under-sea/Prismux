import { describe, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  makeProviderSettingsSchema,
  SourceControlProviderKind,
} from "@t3tools/contracts";
import { UNKNOWN_SOURCE_CONTROL_CLIENT } from "@t3tools/client-runtime/source-control-clients";
import * as Schema from "effect/Schema";
import { decodeMsg } from "gt-react";

import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  getThreadAutoSettlementSearchAvailability,
  isSettingsSearchScopeAvailable,
  movedSettingsPath,
  searchSettings,
  settingsNavGroups,
  SETTINGS_SEARCH_ITEMS,
  sourceControlHostSearchItems,
  sourceControlHostSettingsSearchId,
  type SettingsSearchItem,
} from "./settingsSearch";

const ITEMS: ReadonlyArray<SettingsSearchItem> = [
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/general",
    searchTerms: ["long lines in code previews"],
  },
  {
    id: "network-access",
    title: "Network access",
    to: "/settings/access",
    searchTerms: ["remote pairing backend"],
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
    searchTerms: ["claude codex agents"],
  },
  {
    id: "provider-updates",
    title: "Update checks",
    to: "/settings/general",
  },
  {
    id: "automatic-updates",
    title: "Automatic updates",
    to: "/settings/general",
  },
];

describe("searchSettings", () => {
  it("matches titles, sections, and remembered setting details", () => {
    expect(searchSettings("word", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("network", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("sharing", ITEMS).map((item) => item.id)).toEqual(["network-access"]);
    expect(searchSettings("claude", ITEMS).map((item) => item.id)).toEqual(["providers"]);
    expect(searchSettings("long lines", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    const spanish = (message: string) => (message === "Word wrap" ? "Ajuste de línea" : message);
    expect(searchSettings("ajuste", ITEMS, spanish).map((item) => item.id)).toEqual(["word-wrap"]);
    for (const query of ["fallback", "fallback agent", "fallback model"]) {
      expect(searchSettings(query)[0]).toMatchObject({
        id: "fallback-model",
        to: "/settings/chat",
        scope: "environment-defaults",
      });
    }
  });

  it("shows the Secrets page in nav and search only when an environment enables secret providers", () => {
    const availability = {
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    for (const enabled of [false, true]) {
      const navPaths = settingsNavGroups(enabled).flatMap((group) => group.paths);
      const searchPaths = searchSettings(
        "1password",
        filterAvailableSettingsSearchItems({
          ...availability,
          hasSecretProvidersEnvironment: enabled,
        }),
      ).map((item) => item.to);
      expect(navPaths.includes("/settings/secrets")).toBe(enabled);
      expect(searchPaths.includes("/settings/secrets")).toBe(enabled);
    }
  });

  it("finds where subagents and side chats open by any of its names", () => {
    for (const query of ["side panel", "subagent", "side chat", "linked thread", "middle click"]) {
      expect(searchSettings(query).map((item) => item.id)).toContain("side-thread-open-target");
    }
  });

  it("omits Scheduled tasks from Settings sidebar and search after promotion to standalone /scheduled-tasks panel", () => {
    const navPaths = settingsNavGroups(true, true).flatMap((group) => group.paths);
    expect(navPaths).not.toContain("/settings/scheduled-tasks");
    expect(
      SETTINGS_SEARCH_ITEMS.some((item) => item.to === "/settings/scheduled-tasks"),
    ).toBe(false);
    expect(
      searchSettings("scheduled tasks").some((item) => item.to === "/settings/scheduled-tasks"),
    ).toBe(false);
  });

  it("matches normalized title substrings", () => {
    expect(searchSettings("  WORD   WRAP  ", ITEMS).map((item) => item.id)).toEqual(["word-wrap"]);
    expect(searchSettings("panel animations").map((item) => item.id)).toEqual(["panel-animations"]);
    expect(searchSettings("thè\u{1ab0}mes")[0]).toMatchObject({
      id: "theme",
      to: "/settings/appearance",
      targetId: "prismux-appearance",
    });
    const localeLowerCase = vi.spyOn(String.prototype, "toLocaleLowerCase").mockReturnValue("gıt");
    try {
      expect(searchSettings("GIT")[0]?.id).toBe("git-fetch-interval");
      expect(localeLowerCase).not.toHaveBeenCalled();
    } finally {
      localeLowerCase.mockRestore();
    }
    expect(searchSettings("xyzzy")).toEqual([]);
  });

  it("omits deduplicated glass-opacity, environment-identification, contrast, chat-width, and tool-call-visibility settings, and exposes the 3 DSH work-step controls", () => {
    const allIds = new Set<string>(SETTINGS_SEARCH_ITEMS.map((item) => item.id));
    expect(allIds.has("setting-glass-opacity")).toBe(false);
    expect(allIds.has("environment-identification")).toBe(false);
    expect(allIds.has("setting-appearance-contrast")).toBe(false);
    expect(allIds.has("chat-width")).toBe(false);
    expect(allIds.has("tool-call-visibility")).toBe(false);
    expect(allIds.has("work-steps-display")).toBe(true);
    expect(allIds.has("work-steps-collapse-timing")).toBe(true);
    expect(allIds.has("collapsed-assistant-reply-mode")).toBe(true);
    expect(searchSettings("glass opacity")).toEqual([]);
    expect(searchSettings("environment identification")).toEqual([]);
    expect(searchSettings("work steps display")[0]).toMatchObject({
      id: "work-steps-display",
      to: "/settings/chat",
    });
    expect(SETTINGS_SEARCH_ITEMS.find((item) => item.id === "color-scheme")?.targetId).toBe(
      "prismux-appearance",
    );
    expect(SETTINGS_SEARCH_ITEMS.find((item) => item.id === "theme")?.targetId).toBe(
      "prismux-appearance",
    );
  });

  it("reflects all RC.2 settings route/tab moves, Antigravity lock search entry, and mobile-app dedup", () => {
    const byId = new Map<string, SettingsSearchItem>(
      SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const),
    );
    // Moved from /settings/appearance, /settings/source-control, and /settings/general -> /settings/chat
    for (const id of [
      "work-steps-display",
      "work-steps-collapse-timing",
      "collapsed-assistant-reply-mode",
      "effort-display",
      "math-rendering",
      "thread-details-items",
      "composer-context",
      "proactive-panels",
      "working-shelf",
    ]) {
      expect(byId.get(id)?.to, id).toBe("/settings/chat");
    }
    // Moved from /settings/chat -> /settings/projects
    for (const id of ["add-project-starts-in", "ghq-clone-layout"]) {
      expect(byId.get(id)?.to, id).toBe("/settings/projects");
    }
    // Retargeted from /settings/providers -> /settings/maintenance#background-activity
    expect(byId.get("provider-health-check-interval")).toMatchObject({
      to: "/settings/maintenance",
      targetId: "background-activity",
      environmentOnly: true,
      scope: "environment-defaults",
    });
    // Deduplicated mobile-app removed from /settings/about; mobile-qr-pairing kept under /settings/connections
    expect(byId.has("mobile-app")).toBe(false);
    expect(byId.has("reopen-onboarding")).toBe(false);
    expect(byId.get("mobile-qr-pairing")).toMatchObject({
      to: "/settings/connections",
      targetId: "mobile-qr-pairing",
    });
    // Added Antigravity controlled-agent lock under /settings/providers#antigravity-controlled-lock
    expect(searchSettings("Antigravity controlled-agent lock")[0]).toMatchObject({
      id: "antigravity-controlled-lock",
      to: "/settings/providers",
      targetId: "antigravity-controlled-lock",
    });
  });

  it("matches query words across fields and ranks the strongest result first", () => {
    expect(searchSettings("pairing remote", ITEMS).map((item) => item.id)).toEqual([
      "network-access",
    ]);
    expect(
      searchSettings("remote pairing")
        .slice(0, 2)
        .map((item) => item.id),
    ).toEqual(["network-access", "connections-environment"]);
  });

  it("hides desktop-only settings from browser search", () => {
    expect(SETTINGS_SEARCH_ITEMS.some((item) => item.id === "quit-confirmation")).toBe(true);
    expect(searchSettings("hold to quit")).toEqual([]);
    expect(searchSettings("wsl")).toEqual([]);
    expect(searchSettings("update track")).toEqual([]);
  });

  it("hides settings whose controls are unavailable", () => {
    const available = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: false,
      hasProviderSettingsEnvironment: false,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    });

    const gatedIds = new Set<string>([
      "follow-change-request-templates",
      "git-fetch-interval",
      "network-access",
      "publish-agent-activity",
      "provider-health-check-interval",
      "source-control-writer-model",
      "review-guide-model",
      "review-guide-instructions",
      "source-control-writing-style",
      "t3-connect",
      "hold-webhooks-while-offline",
      "tailscale-https",
      "wsl-backend",
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
      "linked-environments",
    ]);
    expect(available.map((item) => item.id).filter((id) => gatedIds.has(id))).toEqual([]);
  });

  it("finds linked environments on a remote host without local maintenance access", () => {
    const availability = {
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      canManageLocalBackend: false,
      localEnvironmentDisabled: true,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    const results = (hasPeerLinkHost: boolean) =>
      searchSettings(
        "linked environments",
        filterAvailableSettingsSearchItems({ ...availability, hasPeerLinkHost }),
      );
    expect(results(false).map((item) => item.id)).not.toContain("linked-environments");
    expect(results(true)).toContainEqual(
      expect.objectContaining({
        id: "linked-environments",
        to: "/settings/connections",
        targetId: "linked-environments",
      }),
    );
  });

  it("finds the Welcome page only where a primary computer can open it", () => {
    const availability = {
      hasCloudPublicConfig: true,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: false,
    };
    const ids = (hasPrimaryEnvironment: boolean) =>
      searchSettings(
        "welcome page",
        filterAvailableSettingsSearchItems({ ...availability, hasPrimaryEnvironment }),
      ).map((item) => item.id);
    // Hosted web reaches remote computers but has no primary one to set up.
    expect(ids(false)).not.toContain("welcome-page");
    expect(ids(true)).toContain("welcome-page");
  });

  it("finds keybinding commands by label, command id, and default key", () => {
    expect(searchSettings("toggle sidebar")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("sidebar.toggle")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("mod+b")[0]?.id).toBe("keybinding-sidebar.toggle");
    expect(searchSettings("copy link")[0]).toMatchObject({
      id: "keybinding-thread.copyReference",
      to: "/settings/keybindings",
    });
  });

  it("sends commands without a default binding to the section", () => {
    expect(searchSettings("thread.stop")[0]).toMatchObject({
      id: "keybinding-thread.stop",
      targetId: "keybindings",
    });
    expect(searchSettings("sidebar.toggle")[0]?.targetId).toBeUndefined();
  });

  it("finds rows by the titles shown on their pages", () => {
    for (const [title, id] of [
      ["Automatic worktree cleanup", "storage-worktrees"],
      ["Delete settled worktrees", "storage-worktrees"],
      ["Delete old browser artifacts", "storage-artifacts"],
      ["Delete old rotated logs", "storage-artifacts"],
      ["Custom search URL", "browser-search-engine"],
      ["Native sessions", "providers"],
      ["CODEX_HOME path", "providers"],
      ["Shadow home path", "providers"],
    ] as const) {
      expect(searchSettings(title)[0]?.id, title).toBe(id);
    }
  });

  it("keeps catalog result ids unique", () => {
    const ids = SETTINGS_SEARCH_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ranks localized exact title matches first for Prismux sections", () => {
    const zhLabels: Record<string, string> = {
      Appearance: "外观",
      Wallpaper: "壁纸",
      "Wallpaper Engine": "壁纸引擎",
      Plugins: "插件中心",
      "Plugin Center": "插件中心",
      Memory: "记忆",
      Sync: "同步",
      "Chief Thread Slot": "主秘书槽位",
      "Prismux Updates": "软件更新",
    };
    const translate = (message: string) => zhLabels[message] ?? zhLabels[decodeMsg(message)] ?? message;
    expect(searchSettings("壁纸", SETTINGS_SEARCH_ITEMS, translate)[0]?.id).toBe(
      "prismux-wallpaper",
    );
    expect(searchSettings("壁纸引擎", SETTINGS_SEARCH_ITEMS, translate)[0]?.id).toBe(
      "prismux-wallpaper",
    );
    expect(searchSettings("插件中心", SETTINGS_SEARCH_ITEMS, translate)[0]?.id).toBe(
      "prismux-plugins",
    );
    expect(searchSettings("记忆", SETTINGS_SEARCH_ITEMS, translate)[0]).toMatchObject({
      id: "prismux-memory",
      to: "/settings/memory",
    });
    expect(searchSettings("同步", SETTINGS_SEARCH_ITEMS, translate)[0]).toMatchObject({
      id: "prismux-sync",
      to: "/settings/sync",
    });
    expect(searchSettings("软件更新", SETTINGS_SEARCH_ITEMS, translate)[0]?.id).toBe(
      "prismux-updates",
    );
  });
});

describe("settings search targets", () => {
  it("requires an environment for the resolved telemetry export destination", () => {
    const result = searchSettings("OpenTelemetry export").find(
      (item) => item.id === "telemetry-export",
    )!;
    const target = getSettingsSearchTargetScope(result.targetId ?? result.id)!;
    expect(isSettingsSearchScopeAvailable(target.scope, "all")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "project")).toBe(false);
    expect(isSettingsSearchScopeAvailable(target.scope, "environment")).toBe(true);
  });

  it("keeps environment-wide settings out of project scopes", () => {
    const updates = getSettingsSearchTargetScope("provider-update-checks")!;
    expect(updates.scope).toBe("environment-defaults");
    expect(isSettingsSearchScopeAvailable(updates.scope, "environment")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "all")).toBe(true);
    expect(isSettingsSearchScopeAvailable(updates.scope, "project")).toBe(false);
    const fallback = getSettingsSearchTargetScope("fallback-model")!;
    expect(fallback.scope).toBe("environment-defaults");
    expect(isSettingsSearchScopeAvailable(fallback.scope, "environment")).toBe(true);
    expect(isSettingsSearchScopeAvailable(fallback.scope, "all")).toBe(true);
    expect(isSettingsSearchScopeAvailable(fallback.scope, "project")).toBe(false);
    for (const id of ["response-streaming", "speech-project-dictionary"]) {
      expect(getSettingsSearchTargetScope(id)?.scope).toBe("project-defaults");
    }
    for (const scope of ["all", "environment", "project"] as const) {
      expect(isSettingsSearchScopeAvailable("project-defaults", scope)).toBe(true);
    }
    for (const id of ["work-steps-display", "composer-rich-text"]) {
      expect(getSettingsSearchTargetScope(id)!.scope).toBeNull();
    }
  });
});

describe("auto-settlement search availability", () => {
  function environment(id: string, { connected = true, loaded = true } = {}) {
    return {
      environmentId: EnvironmentId.make(id),
      connection: { phase: connected ? ("connected" as const) : ("offline" as const) },
      serverConfig: loaded ? { environment: { capabilities: {} } } : null,
    };
  }

  const capable = environment("capable");
  const offline = environment("offline", { connected: false });
  const loading = environment("loading", { loaded: false });
  const environments = [capable, offline, loading];

  it("keeps results discoverable when one connected environment supports them", () => {
    const availability = getThreadAutoSettlementSearchAvailability(environments);
    expect(availability.eligibleEnvironmentIds).toEqual([capable.environmentId]);
    const items = filterAvailableSettingsSearchItems({
      hasCloudPublicConfig: false,
      hasEnvironment: true,
      hasProviderSettingsEnvironment: true,
      canManageLocalBackend: false,
      isWslSettingsRowVisible: false,
      hasThreadAutoSettlement: availability.eligibleEnvironmentIds.length > 0,
    });
    expect(searchSettings("auto-settle", items).map((item) => item.id)).toEqual([
      "auto-settle-inactive-threads",
      "auto-settle-merged-threads",
      "days-before-auto-settle",
      "keep-threads-with-pull-requests",
    ]);
  });

  it.each([offline, loading])(
    "does not render the target on $environmentId or silently fall back",
    (selected) => {
      expect(
        getThreadAutoSettlementSearchAvailability(environments, {
          kind: "environment",
          environmentIds: [selected.environmentId],
        }),
      ).toEqual({ eligibleEnvironmentIds: [capable.environmentId], isTargetAvailable: false });
    },
  );

  it("ignores offline and unloaded targets when all connected targets support the setting", () => {
    const selected = [capable, offline, loading];
    expect(
      getThreadAutoSettlementSearchAvailability(selected, {
        kind: "all",
        environmentIds: selected.map((entry) => entry.environmentId),
      }).isTargetAvailable,
    ).toBe(true);
  });
});

describe("source control host search items", () => {
  const definition = {
    ...UNKNOWN_SOURCE_CONTROL_CLIENT,
    kind: SourceControlProviderKind.make("example"),
    label: "Example",
    searchKeywords: ["sample"],
    settings: makeProviderSettingsSchema({ apiToken: Schema.String }),
  };

  it("lists a host by its label, its keywords, and its settings fields", () => {
    const items = sourceControlHostSearchItems([UNKNOWN_SOURCE_CONTROL_CLIENT, definition]);
    expect(items.map((item) => decodeMsg(item.title))).toEqual(["Example credentials"]);
    expect(searchSettings("sample apitoken", items).map((item) => item.id)).toEqual([
      sourceControlHostSettingsSearchId("example"),
    ]);
  });

  it("lists a host with credentials by its accounts, token and CLI", () => {
    const items = sourceControlHostSearchItems([
      {
        ...definition,
        credentials: {
          cliName: "ex",
          cliLabel: "Example CLI",
          loginCommand: "ex login",
          tokenEnvVar: "EX_TOKEN",
          tokenAccess: "access",
          newTokenUrl: (host) => `https://${host}/tokens`,
        },
      },
    ]);
    expect(items.map((item) => decodeMsg(item.title))).toEqual(["Example accounts and token"]);
    expect(searchSettings("ex switch accounts", items)).toHaveLength(1);
  });

  it("finds the built-in hosts by their own words", () => {
    expect(searchSettings("codeberg").map((item) => item.id)).toContain("source-control");
    expect(searchSettings("ghes").map((item) => item.id)).toContain(
      sourceControlHostSettingsSearchId("github"),
    );
  });
  it("omits Overnight Factory from Settings sidebar and search after promotion to standalone /overnight-factory panel", () => {
    const navPaths = settingsNavGroups(true, true).flatMap((group) => group.paths);
    expect(navPaths).not.toContain("/settings/overnight-factory");
    expect(
      SETTINGS_SEARCH_ITEMS.some((item) => item.to === "/settings/overnight-factory"),
    ).toBe(false);
    expect(
      searchSettings("Overnight Factory").some((item) => item.to === "/settings/overnight-factory"),
    ).toBe(false);
  });
});

describe("movedSettingsPath", () => {
  it("sends old links to the page their row moved to", () => {
    expect(movedSettingsPath("/settings/general", "text-generation-model")).toBe(
      "/settings/chat",
    );
    expect(movedSettingsPath("/settings/connections", "authorized-clients")).toBeNull();
    expect(movedSettingsPath("/settings/source-control", "worktree-branch-naming")).toBeNull();
    expect(movedSettingsPath("/settings/appearance", "diff-color-scheme")).toBe(
      "/settings/source-control",
    );
    expect(movedSettingsPath("/settings/connections", "network-access")).toBeNull();
    expect(movedSettingsPath("/settings/storage", "storage-worktrees")).toBe(
      "/settings/source-control",
    );
    expect(movedSettingsPath("/settings/storage", "")).toBe("/settings/maintenance");
    expect(movedSettingsPath("/settings/integrations", "devices")).toBe("/settings/browser");
    expect(movedSettingsPath("/settings/beta", "")).toBe("/settings/general");
    expect(movedSettingsPath("/settings/labs", "")).toBe("/settings/general");
    expect(movedSettingsPath("/settings/updates", "")).toBe("/settings/about");
    expect(movedSettingsPath("/settings/memory-sync", "")).toBe("/settings/memory");
    expect(movedSettingsPath("/settings/memory-sync", "sync")).toBe("/settings/sync");
    expect(movedSettingsPath("/settings/memory-sync", "prismux-e2ee-sync")).toBe("/settings/sync");
    expect(movedSettingsPath("/settings/appearance", "work-steps-display")).toBe("/settings/chat");
    expect(movedSettingsPath("/settings/appearance", "composer-context")).toBe("/settings/chat");
    expect(movedSettingsPath("/settings/source-control", "proactive-panels")).toBe("/settings/chat");
    expect(movedSettingsPath("/settings/general", "working-shelf")).toBe("/settings/chat");
    expect(movedSettingsPath("/settings/general", "reopen-onboarding")).toBe("/settings/about");
    expect(movedSettingsPath("/settings/chat", "add-project-starts-in")).toBe("/settings/projects");
    expect(movedSettingsPath("/settings/chat", "ghq-clone-layout")).toBe("/settings/projects");
    expect(movedSettingsPath("/settings/providers", "provider-health-check-interval")).toBe(
      "/settings/maintenance",
    );
    expect(movedSettingsPath("/settings/about", "mobile-app")).toBe("/settings/connections");
  });

  it("leaves current pages alone", () => {
    expect(movedSettingsPath("/settings/general", "time-format")).toBeNull();
    expect(movedSettingsPath("/settings/projects", "project-defaults")).toBeNull();
    expect(movedSettingsPath("/settings/connections", "remote-environments")).toBeNull();
    expect(movedSettingsPath("/settings/appearance", "theme")).toBeNull();
  });
});
